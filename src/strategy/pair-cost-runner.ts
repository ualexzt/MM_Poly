import { MarketState } from '../types/market';
import { BookState } from '../types/book';
import { PairCostConfig, PairCostOpportunity, scanPairCostOpportunities } from '../engines/pair-cost-scanner';

export interface OrderbookClient {
  fetchBook(conditionId: string, tokenId: string): Promise<BookState>;
}

export interface MarketScanner {
  fetchMarkets(): Promise<MarketState[]>;
}

export interface EventLogger {
  write(event: Record<string, unknown>): boolean;
}

export interface FetchPairOptions {
  onError?: (error: Error) => void;
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
      options?.onError?.(err as Error);
    }
  }

  return result;
}

export async function runPairCostScanCycle(
  marketScanner: MarketScanner,
  orderbookClient: OrderbookClient,
  logger: EventLogger,
  config: PairCostConfig,
): Promise<PairCostOpportunity[]> {
  try {
    const allMarkets = await marketScanner.fetchMarkets();
    const markets = allMarkets.filter(m => m.active && !m.closed && m.enableOrderBook && m.yesTokenId && m.noTokenId);

    const orderbooks = await fetchPairOrderbooks(orderbookClient, markets, {
      onError: (err) => logger.write({ eventType: 'fetch_error', error: err.message }),
    });

    const opportunities = scanPairCostOpportunities(markets, orderbooks, config);

    if (opportunities.length > 0) {
      for (const opp of opportunities) {
        logger.write({ eventType: 'pair_opportunity', ...opp });
      }
    } else {
      logger.write({ eventType: 'no_opportunities', marketsScanned: markets.length });
    }

    return opportunities;
  } catch (err) {
    logger.write({ eventType: 'cycle_error', error: (err as Error).message });
    return [];
  }
}
