import { buildStatsMarketFilter, toCandidateStats } from '../../src/scripts/shadow-stats-collector';
import { defaultConfig } from '../../src/strategy/config';
import type { MarketState } from '../../src/types/market';
import type { BookState } from '../../src/types/book';
import type { QuoteCandidate } from '../../src/types/quote';

describe('shadow-stats-collector helpers', () => {
  test('builds stats market filter without mutating default config', () => {
    const filter = buildStatsMarketFilter(1);

    expect(filter.minSpreadTicks).toBe(1);
    expect(defaultConfig.marketFilter.minSpreadTicks).toBe(3);
  });

  test('computes buy and sell edge to fair in cents', () => {
    const market: MarketState = {
      conditionId: 'cond-1', yesTokenId: 'yes1', noTokenId: 'no1', active: true, closed: false,
      enableOrderBook: true, feesEnabled: true, volume24hUsd: 10000, liquidityUsd: 5000,
      oracleAmbiguityScore: 0.05, resolutionSource: 'https://example.com', slug: 'market', question: 'Market?',
    };
    const book: BookState = {
      tokenId: 'yes1', conditionId: 'cond-1',
      bids: [], asks: [], bestBid: 0.49, bestAsk: 0.51,
      bestBidSizeUsd: 100, bestAskSizeUsd: 100,
      midpoint: 0.5, spread: 0.02, spreadTicks: 2,
      depth1Usd: 200, depth3Usd: 500,
      tickSize: 0.01, minOrderSize: 5, lastUpdateMs: 1,
    };
    const baseQuote: QuoteCandidate = {
      conditionId: 'cond-1', tokenId: 'yes1', side: 'BUY', price: 0.48, size: 5, sizeUsd: 2.4,
      postOnly: true, orderType: 'GTC', fairPrice: 0.5, targetHalfSpreadCents: 2,
      inventorySkewCents: 0, toxicityScore: 0.1, reason: 'quote_generated', riskFlags: [],
    };

    const buy = toCandidateStats({ timestamp: 't', market, book, quote: baseQuote, targetHalfSpreadCents: 2 });
    const sell = toCandidateStats({ timestamp: 't', market, book, quote: { ...baseQuote, side: 'SELL', price: 0.53 }, targetHalfSpreadCents: 2 });

    expect(buy.edgeToFairCents).toBeCloseTo(2);
    expect(sell.edgeToFairCents).toBeCloseTo(3);
    expect(buy.requiresInventory).toBe(false);
    expect(sell.requiresInventory).toBe(true);
  });
});
