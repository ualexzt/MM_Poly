import { buildPairCostAnalyticsEvents, PairCostAnalyticsConfig } from '../analytics/pair-cost-analytics';
import { BookState } from '../types/book';
import { MarketState } from '../types/market';
import { decidePairCostStrategyTick } from '../engines/pair-cost-strategy';
import {
  InventoryLot,
  PairCostDecision,
  PairCostStrategyConfig,
  PairCostStrategyOrder,
} from '../engines/pair-cost-types';

export interface OrderbookClient {
  fetchBook(conditionId: string, tokenId: string): Promise<BookState>;
}

export interface MarketScanner {
  fetchMarkets(): Promise<MarketState[]>;
}

export interface EventLogger {
  write(event: Record<string, unknown>): boolean;
}

export interface PairCostLotStore {
  getLots(marketId: string): Promise<InventoryLot[]> | InventoryLot[];
}

export interface PairCostActiveOrderStore {
  getActiveOrder(marketId: string): Promise<PairCostStrategyOrder | null> | PairCostStrategyOrder | null;
}

export interface FetchPairOptions {
  onError?: (error: Error, market: MarketState) => void;
}

export interface PairCostHedgeCycleConfig {
  strategy: PairCostStrategyConfig;
  tradingEnabled: boolean;
  analytics: PairCostAnalyticsConfig;
  now?: Date;
  maxMarkets?: number;
}

export interface RunPairCostHedgeCycleInput {
  marketScanner: MarketScanner;
  orderbookClient: OrderbookClient;
  logger: EventLogger;
  lotStore: PairCostLotStore;
  activeOrderStore?: PairCostActiveOrderStore;
  config: PairCostHedgeCycleConfig;
}

export interface PairCostHedgeCycleResult {
  marketsFetched: number;
  marketsEligible: number;
  booksFetched: number;
  fetchErrors: number;
  decisions: PairCostDecision[];
}

export class EmptyPairCostLotStore implements PairCostLotStore {
  getLots(): InventoryLot[] {
    return [];
  }
}

function isEligibleMarket(market: MarketState): boolean {
  return market.active && !market.closed && market.enableOrderBook && Boolean(market.yesTokenId) && Boolean(market.noTokenId);
}

function timeToCloseSeconds(market: MarketState, now: Date): number {
  if (!market.endDate) return Number.POSITIVE_INFINITY;
  const endMs = Date.parse(market.endDate);
  if (!Number.isFinite(endMs)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((endMs - now.getTime()) / 1000));
}

export async function fetchPairOrderbooks(
  client: OrderbookClient,
  markets: MarketState[],
  options?: FetchPairOptions,
): Promise<Map<string, { yes: BookState; no: BookState }>> {
  const result = new Map<string, { yes: BookState; no: BookState }>();

  for (const market of markets) {
    try {
      const [yesBook, noBook] = await Promise.all([
        client.fetchBook(market.conditionId, market.yesTokenId),
        client.fetchBook(market.conditionId, market.noTokenId),
      ]);
      result.set(market.conditionId, { yes: yesBook, no: noBook });
    } catch (err) {
      options?.onError?.(err as Error, market);
    }
  }

  return result;
}

export async function runPairCostHedgeCycle(input: RunPairCostHedgeCycleInput): Promise<PairCostHedgeCycleResult> {
  const now = input.config.now ?? new Date();

  try {
    const allMarkets = await input.marketScanner.fetchMarkets();
    const eligibleMarkets = allMarkets
      .filter(isEligibleMarket)
      .slice(0, input.config.maxMarkets ?? allMarkets.length);

    let fetchErrors = 0;
    const orderbooks = await fetchPairOrderbooks(input.orderbookClient, eligibleMarkets, {
      onError: (err, market) => {
        fetchErrors += 1;
        input.logger.write({
          eventType: 'fetch_error',
          strategy: 'pair_cost',
          marketId: market.conditionId,
          slug: market.slug,
          error: err.message,
        });
      },
    });

    input.logger.write({
      eventType: 'pair_cost_market_data',
      strategy: 'pair_cost',
      timestamp: now.toISOString(),
      marketsFetched: allMarkets.length,
      marketsEligible: eligibleMarkets.length,
      booksFetched: orderbooks.size,
      fetchErrors,
    });

    const decisions: PairCostDecision[] = [];

    for (const market of eligibleMarkets) {
      const books = orderbooks.get(market.conditionId);
      if (!books) continue;

      for (const event of buildPairCostAnalyticsEvents({
        market,
        yesBook: books.yes,
        noBook: books.no,
        config: input.config.analytics,
        now,
      })) {
        input.logger.write(event);
      }

      const lots = await input.lotStore.getLots(market.conditionId);
      const activeOrder = await input.activeOrderStore?.getActiveOrder(market.conditionId) ?? null;
      const decision = decidePairCostStrategyTick({
        marketId: market.conditionId,
        config: input.config.strategy,
        lots,
        books: { YES: books.yes, NO: books.no },
        now,
        timeToCloseSeconds: timeToCloseSeconds(market, now),
        market: { enabled: true, closed: market.closed, resolving: false },
        activeOrder,
        currentMarketExposureUsd: lots.reduce((sum, lot) => sum + lot.remainingQty * lot.price, 0),
      });

      decisions.push(decision);
      input.logger.write({
        eventType: 'pair_cost_decision',
        ...decision.log,
      });

      if (decision.decision === 'PLACE_ORDER' && !input.config.tradingEnabled) {
        input.logger.write({
          eventType: 'pair_cost_order_blocked',
          strategy: 'pair_cost',
          timestamp: now.toISOString(),
          marketId: market.conditionId,
          reason: 'TRADING_DISABLED',
          wouldPlace: decision.order,
        });
      }

      if (decision.decision === 'CANCEL_ORDER' && !input.config.tradingEnabled) {
        input.logger.write({
          eventType: 'pair_cost_cancel_blocked',
          strategy: 'pair_cost',
          timestamp: now.toISOString(),
          marketId: market.conditionId,
          reason: 'TRADING_DISABLED',
          cancelOrderId: decision.cancelOrderId,
        });
      }
    }

    return {
      marketsFetched: allMarkets.length,
      marketsEligible: eligibleMarkets.length,
      booksFetched: orderbooks.size,
      fetchErrors,
      decisions,
    };
  } catch (err) {
    input.logger.write({
      eventType: 'cycle_error',
      strategy: 'pair_cost',
      timestamp: now.toISOString(),
      error: (err as Error).message,
    });
    return { marketsFetched: 0, marketsEligible: 0, booksFetched: 0, fetchErrors: 0, decisions: [] };
  }
}
