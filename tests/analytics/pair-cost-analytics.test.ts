import { BookState } from '../../src/types/book';
import { MarketState } from '../../src/types/market';
import {
  buildPairCostAnalyticsEvents,
  PairCostAnalyticsConfig,
} from '../../src/analytics/pair-cost-analytics';

const NOW = new Date('2026-01-01T00:00:00.000Z');

function market(overrides: Partial<MarketState> = {}): MarketState {
  return {
    conditionId: 'market-1',
    slug: 'market-slug',
    question: 'Will X happen?',
    yesTokenId: 'yes-1',
    noTokenId: 'no-1',
    active: true,
    closed: false,
    enableOrderBook: true,
    feesEnabled: true,
    volume24hUsd: 1000,
    liquidityUsd: 500,
    oracleAmbiguityScore: 0,
    endDate: '2026-01-01T01:00:00.000Z',
    ...overrides,
  };
}

function book(overrides: Partial<BookState> = {}): BookState {
  return {
    tokenId: 'token-1',
    conditionId: 'market-1',
    bids: [{ price: 0.50, size: 20, sizeUsd: 10 }],
    asks: [{ price: 0.49, size: 20, sizeUsd: 9.8 }],
    bestBid: 0.48,
    bestAsk: 0.49,
    bestBidSizeUsd: 10,
    bestAskSizeUsd: 9.8,
    midpoint: 0.485,
    spread: 0.01,
    spreadTicks: 1,
    depth1Usd: 19.8,
    depth3Usd: 19.8,
    tickSize: 0.01,
    minOrderSize: 1,
    lastUpdateMs: NOW.getTime() - 250,
    ...overrides,
  };
}

const CONFIG: PairCostAnalyticsConfig = {
  enabled: true,
  sampleUsd: [5],
  maxPairCost: 0.985,
  minEdgePerPair: 0.015,
};

describe('buildPairCostAnalyticsEvents', () => {
  it('builds executable snapshot and opportunity events from ask-walk prices', () => {
    const events = buildPairCostAnalyticsEvents({
      market: market(),
      yesBook: book({
        tokenId: 'yes-1',
        asks: [
          { price: 0.43, size: 2, sizeUsd: 0.86 },
          { price: 0.44, size: 3, sizeUsd: 1.32 },
        ],
        bestAsk: 0.43,
      }),
      noBook: book({
        tokenId: 'no-1',
        asks: [{ price: 0.53, size: 5, sizeUsd: 2.65 }],
        bestAsk: 0.53,
      }),
      config: CONFIG,
      now: NOW,
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual(expect.objectContaining({
      eventType: 'pair_cost_executable_snapshot',
      marketId: 'market-1',
      slug: 'market-slug',
      sampleUsd: 5,
      requestedQty: 5,
      yesExecutableQty: 5,
      noExecutableQty: 5,
      yesAvgPrice: 0.436,
      noAvgPrice: 0.53,
      pairCost: 0.966,
      edgePerPair: 0.034,
      enoughDepth: true,
      opportunity: true,
      timeToCloseSeconds: 3600,
      yesOrderbookAgeMs: 250,
      noOrderbookAgeMs: 250,
    }));
    expect(events[1]).toEqual(expect.objectContaining({
      eventType: 'pair_cost_opportunity_detected',
      marketId: 'market-1',
      sampleUsd: 5,
      pairCost: 0.966,
      edgePerPair: 0.034,
    }));
  });

  it('records non-opportunity snapshots when depth is insufficient', () => {
    const events = buildPairCostAnalyticsEvents({
      market: market(),
      yesBook: book({ asks: [{ price: 0.43, size: 2, sizeUsd: 0.86 }], bestAsk: 0.43 }),
      noBook: book({ asks: [{ price: 0.53, size: 5, sizeUsd: 2.65 }], bestAsk: 0.53 }),
      config: CONFIG,
      now: NOW,
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(expect.objectContaining({
      eventType: 'pair_cost_executable_snapshot',
      enoughDepth: false,
      opportunity: false,
    }));
  });

  it('does not mark samples below CLOB min order size as opportunities', () => {
    const events = buildPairCostAnalyticsEvents({
      market: market(),
      yesBook: book({ minOrderSize: 1, asks: [{ price: 0.43, size: 5, sizeUsd: 2.15 }], bestAsk: 0.43 }),
      noBook: book({ minOrderSize: 1, asks: [{ price: 0.53, size: 5, sizeUsd: 2.65 }], bestAsk: 0.53 }),
      config: { ...CONFIG, sampleUsd: [0.5] },
      now: NOW,
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(expect.objectContaining({
      eventType: 'pair_cost_executable_snapshot',
      requestedQty: 0.5,
      minOrderSizeSatisfied: false,
      opportunity: false,
    }));
  });

  it('returns no events when analytics is disabled', () => {
    const events = buildPairCostAnalyticsEvents({
      market: market(),
      yesBook: book(),
      noBook: book(),
      config: { ...CONFIG, enabled: false },
      now: NOW,
    });

    expect(events).toEqual([]);
  });
});
