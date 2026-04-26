import { StrategyConfig } from '../types/config';
import { MarketScanner } from '../data/gamma-market-scanner';
import { OrderbookClient } from '../data/clob-orderbook-client';
import { PaperExecutionEngine } from '../simulation/paper-execution-engine';
import { Logger } from '../utils/logger';
import { filterEligibleMarkets } from './market-selector';
import { computeFairPrice } from '../engines/fair-price-engine';
import { generateQuoteCandidates } from '../engines/quote-engine';
import { createTrace } from '../accounting/decision-trace';
import { KillSwitch } from '../risk/kill-switch';
import { isBookStale } from '../risk/stale-book-guard';

export interface StrategyRunnerDeps {
  config: StrategyConfig;
  scanner: MarketScanner;
  bookClient: OrderbookClient;
  paperEngine: PaperExecutionEngine;
  logger: Logger;
}

export class StrategyRunner {
  private killSwitch: KillSwitch;

  constructor(private deps: StrategyRunnerDeps) {
    this.killSwitch = new KillSwitch(deps.config.risk);
  }

  async runCycle(): Promise<void> {
    const { config, scanner, bookClient, paperEngine, logger } = this.deps;

    if (config.mode === 'disabled') {
      logger.info('Strategy disabled');
      return;
    }

    const ks = this.killSwitch.check(
      { connected: true, disconnectedAt: null },
      { errorsLast60s: 0, totalLast60s: 100 },
      { currentDrawdownPct: 0 }
    );

    if (ks === 'CANCEL_ALL' || ks === 'DISABLE_STRATEGY') {
      logger.warn('Kill switch triggered', { state: ks });
      paperEngine.getOpenOrders().forEach(o => paperEngine.cancel(o.id));
      if (ks === 'DISABLE_STRATEGY') return;
    }

    const markets = await scanner.fetchMarkets();
    const eligible = filterEligibleMarkets(markets, config.marketFilter);

    for (const market of eligible) {
      try {
        const yesBook = await bookClient.fetchBook(market.conditionId, market.yesTokenId);
        const noBook = await bookClient.fetchBook(market.conditionId, market.noTokenId);

        if (isBookStale(yesBook.lastUpdateMs, config.staleOrderMaxAgeMs)) {
          logger.warn('Stale book', { conditionId: market.conditionId });
          continue;
        }

        const yesFair = computeFairPrice({
          bestBid: yesBook.bestBid || 0, bestAsk: yesBook.bestAsk || 0,
          bestBidSize: yesBook.bestBidSizeUsd, bestAskSize: yesBook.bestAskSizeUsd,
          lastTradeEma: yesBook.lastTradePrice || null,
          complementMidpoint: noBook.midpoint,
          weights: config.fairPrice.weights
        });

        if (!yesFair) continue;

        const toxicityScore = 0.1;
        const inventorySkew = 0;

        for (const side of ['BUY', 'SELL'] as const) {
          const quotes = generateQuoteCandidates({
            conditionId: market.conditionId,
            tokenId: market.yesTokenId,
            side,
            fairPrice: yesFair.fairPrice,
            targetHalfSpreadCents: config.spread.baseHalfSpreadCents,
            inventorySkewCents: inventorySkew,
            toxicityScore,
            book: yesBook,
            baseSizeUsd: config.size.baseOrderSizeUsd,
            maxSizeUsd: config.size.maxOrderSizeUsd,
            minOrderSize: yesBook.minOrderSize,
            isBookStale: false
          });

          for (const quote of quotes) {
            const trace = createTrace({
              mode: config.mode,
              conditionId: market.conditionId,
              tokenId: market.yesTokenId,
              side,
              bestBid: yesBook.bestBid,
              bestAsk: yesBook.bestAsk,
              spreadTicks: yesBook.spreadTicks,
              fairPrice: yesFair.fairPrice,
              microprice: yesFair.microprice,
              complementFair: noBook.midpoint,
              lastTradeEma: yesBook.lastTradePrice || null,
              toxicityScore,
              inventoryPct: 0,
              inventorySkewCents: inventorySkew,
              targetPrice: quote.price,
              targetSizeUsd: quote.sizeUsd,
              decision: 'quote',
              reason: quote.reason,
              riskFlags: quote.riskFlags
            });

            logger.trace(trace);

            if (config.mode === 'paper') {
              paperEngine.submit({
                id: `${market.conditionId}-${side}-${Date.now()}`,
                tokenId: market.yesTokenId,
                side,
                price: quote.price,
                size: quote.size,
                sizeUsd: quote.sizeUsd,
                postOnly: true
              });
            }
          }
        }
      } catch (err) {
        logger.error('Cycle error', { conditionId: market.conditionId, error: String(err) });
      }
    }
  }
}
