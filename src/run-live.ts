import { StrategyRunner } from './strategy/strategy-runner';
import { GammaApiScanner } from './data/gamma-market-scanner';
import { ClobApiClient } from './data/clob-orderbook-client';
import { PaperExecutionEngine } from './simulation/paper-execution-engine';
import { defaultConfig } from './strategy/config';
import { ConsoleLogger } from './utils/logger';
import { TelegramNotifier } from './notifier/telegram';
import { computeFairPrice } from './engines/fair-price-engine';
import { filterEligibleMarkets } from './strategy/market-selector';
import { generateQuoteCandidates } from './engines/quote-engine';
import { createTrace } from './accounting/decision-trace';
import { KillSwitch } from './risk/kill-switch';
import { isBookStale } from './risk/stale-book-guard';

const TELEGRAM_BOT_TOKEN = '8751621772:AAHRSaBaX9TjEPrbpuRbhVl51x9DyX2_U2M';
const TELEGRAM_CHAT_ID = '-1003743905862';
const POLL_INTERVAL_MS = 30000; // 30 seconds

async function main() {
  const logger = new ConsoleLogger();
  const telegram = new TelegramNotifier({ botToken: TELEGRAM_BOT_TOKEN, chatId: TELEGRAM_CHAT_ID });
  const paperEngine = new PaperExecutionEngine();
  const scanner = new GammaApiScanner();
  const bookClient = new ClobApiClient();
  const killSwitch = new KillSwitch(defaultConfig.risk);

  logger.info('=== Polymarket MM Strategy — Live Paper Mode ===');
  logger.info(`Mode: ${defaultConfig.mode}`);
  logger.info(`Polling every ${POLL_INTERVAL_MS / 1000}s`);

  await telegram.sendMessage('🚀 <b>Polymarket MM Bot started</b>\nMode: paper (monitoring only)\nPolling: 30s');

  async function cycle() {
    try {
      const ks = killSwitch.check(
        { connected: true, disconnectedAt: null },
        { errorsLast60s: 0, totalLast60s: 100 },
        { currentDrawdownPct: 0 }
      );
      if (ks !== 'OK') {
        logger.warn('Kill switch active', { state: ks });
        return;
      }

      const markets = await scanner.fetchMarkets();
      const eligible = filterEligibleMarkets(markets, defaultConfig.marketFilter);
      logger.info(`Markets: ${markets.length} total, ${eligible.length} eligible`);

      for (const market of eligible.slice(0, 3)) { // limit to 3 markets per cycle
        try {
          if (!market.yesTokenId || !market.noTokenId) continue;

          const yesBook = await bookClient.fetchBook(market.conditionId, market.yesTokenId);
          const noBook = await bookClient.fetchBook(market.conditionId, market.noTokenId);

          if (isBookStale(yesBook.lastUpdateMs, defaultConfig.staleOrderMaxAgeMs)) {
            continue;
          }

          const yesFair = computeFairPrice({
            bestBid: yesBook.bestBid || 0, bestAsk: yesBook.bestAsk || 0,
            bestBidSize: yesBook.bestBidSizeUsd, bestAskSize: yesBook.bestAskSizeUsd,
            lastTradeEma: yesBook.lastTradePrice || null,
            complementMidpoint: noBook.midpoint,
            weights: defaultConfig.fairPrice.weights
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
              targetHalfSpreadCents: defaultConfig.spread.baseHalfSpreadCents,
              inventorySkewCents: inventorySkew,
              toxicityScore,
              book: yesBook,
              baseSizeUsd: defaultConfig.size.baseOrderSizeUsd,
              maxSizeUsd: defaultConfig.size.maxOrderSizeUsd,
              minOrderSize: yesBook.minOrderSize,
              isBookStale: false
            });

            for (const quote of quotes) {
              const trace = createTrace({
                mode: defaultConfig.mode,
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

              paperEngine.submit({
                id: `${market.conditionId}-${side}-${Date.now()}`,
                tokenId: market.yesTokenId,
                side,
                price: quote.price,
                size: quote.size,
                sizeUsd: quote.sizeUsd,
                postOnly: true
              });

              await telegram.sendTradeAlert({
                question: market.question || market.conditionId,
                side,
                price: quote.price,
                size: quote.size,
                fairPrice: yesFair.fairPrice,
                spread: (yesBook.spread || 0)
              });
            }
          }
        } catch (err) {
          logger.error('Cycle error', { conditionId: market.conditionId, error: String(err) });
        }
      }
    } catch (err) {
      logger.error('Top-level cycle error', { error: String(err) });
    }
  }

  // Run first cycle immediately
  await cycle();

  // Then poll
  setInterval(cycle, POLL_INTERVAL_MS);
  logger.info('Polling started');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
