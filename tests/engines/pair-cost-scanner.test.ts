import { MarketState } from '../../src/types/market';
import { BookState } from '../../src/types/book';
import {
  calculatePairCost,
  scanPairCostOpportunities,
  PairCostConfig,
} from '../../src/engines/pair-cost-scanner';

const DEFAULT_CONFIG: PairCostConfig = {
  maxPairCost: 0.99,
  minEdgeBps: 50,
  minLiquidityUsd: 10,
  feeRate: 0.02,
};

function makeMarket(overrides: Partial<MarketState> = {}): MarketState {
  return {
    conditionId: 'cid-1',
    slug: 'test-market',
    question: 'Will X happen?',
    yesTokenId: 'yes-1',
    noTokenId: 'no-1',
    active: true,
    closed: false,
    enableOrderBook: true,
    feesEnabled: true,
    volume24hUsd: 1000,
    liquidityUsd: 500,
    oracleAmbiguityScore: 0.05,
    feeRate: 0.02,
    ...overrides,
  };
}

function makeBook(overrides: Partial<BookState> = {}): BookState {
  return {
    tokenId: 'token-1',
    conditionId: 'cid-1',
    bids: [],
    asks: [],
    bestBid: null,
    bestAsk: null,
    bestBidSizeUsd: 0,
    bestAskSizeUsd: 0,
    midpoint: null,
    spread: null,
    spreadTicks: null,
    depth1Usd: 0,
    depth3Usd: 0,
    tickSize: 0.01,
    minOrderSize: 1,
    lastUpdateMs: Date.now(),
    ...overrides,
  };
}

describe('calculatePairCost', () => {
  it('returns rawCost * (1 + feeRate)', () => {
    expect(calculatePairCost(0.50, 0.48, 0.02)).toBeCloseTo(1.0); // (0.50+0.48)*1.02 = 0.9996
  });

  it('returns exactly 1.0 for break-even pair', () => {
    // (0.49 + 0.49) * 1.02 = 0.9996 → close to 1
    expect(calculatePairCost(0.49, 0.49, 0.02)).toBeCloseTo(0.9996);
  });

  it('returns < 1.0 for profitable pair', () => {
    // (0.45 + 0.45) * 1.02 = 0.918
    expect(calculatePairCost(0.45, 0.45, 0.02)).toBeCloseTo(0.918);
  });

  it('returns > 1.0 for unprofitable pair', () => {
    // (0.55 + 0.55) * 1.02 = 1.122
    expect(calculatePairCost(0.55, 0.55, 0.02)).toBeCloseTo(1.122);
  });

  it('handles zero fee rate', () => {
    expect(calculatePairCost(0.50, 0.48, 0)).toBeCloseTo(0.98);
  });
});

describe('scanPairCostOpportunities', () => {
  it('returns empty when no markets provided', () => {
    expect(scanPairCostOpportunities([], new Map(), DEFAULT_CONFIG)).toEqual([]);
  });

  it('skips markets without orderbook data', () => {
    const markets = [makeMarket()];
    const orderbooks = new Map<string, { yes: BookState; no: BookState }>();
    expect(scanPairCostOpportunities(markets, orderbooks, DEFAULT_CONFIG)).toEqual([]);
  });

  it('skips markets where either bestAsk is null', () => {
    const markets = [makeMarket()];
    const orderbooks = new Map([
      ['cid-1', { yes: makeBook({ bestAsk: null }), no: makeBook({ bestAsk: 0.48 }) }],
    ]);
    expect(scanPairCostOpportunities(markets, orderbooks, DEFAULT_CONFIG)).toEqual([]);
  });

  it('skips markets where allInCost exceeds maxPairCost', () => {
    const markets = [makeMarket()];
    const orderbooks = new Map([
      ['cid-1', { yes: makeBook({ bestAsk: 0.55 }), no: makeBook({ bestAsk: 0.55 }) }],
    ]);
    // allInCost = (0.55+0.55)*1.02 = 1.122 > 0.99
    expect(scanPairCostOpportunities(markets, orderbooks, DEFAULT_CONFIG)).toEqual([]);
  });

  it('skips markets where edgeBps is below minEdgeBps', () => {
    const markets = [makeMarket()];
    const orderbooks = new Map([
      ['cid-1', { yes: makeBook({ bestAsk: 0.505 }), no: makeBook({ bestAsk: 0.485 }) }],
    ]);
    // allInCost = (0.505+0.485)*1.02 = 1.0098 → edge = (1-1.0098)*10000 = -98 bps → negative edge, skipped
    expect(scanPairCostOpportunities(markets, orderbooks, DEFAULT_CONFIG)).toEqual([]);
  });

  it('skips markets where maxSizeUsd is below minLiquidityUsd', () => {
    const markets = [makeMarket()];
    const orderbooks = new Map([
      ['cid-1', {
        yes: makeBook({ bestAsk: 0.45, bestAskSizeUsd: 5 }),
        no: makeBook({ bestAsk: 0.45, bestAskSizeUsd: 50 }),
      }],
    ]);
    // maxSizeUsd = min(5, 50) = 5 < 10 → skipped
    expect(scanPairCostOpportunities(markets, orderbooks, DEFAULT_CONFIG)).toEqual([]);
  });

  it('returns opportunity when pair cost is profitable', () => {
    const markets = [makeMarket()];
    const orderbooks = new Map([
      ['cid-1', {
        yes: makeBook({ bestAsk: 0.45, bestAskSizeUsd: 100 }),
        no: makeBook({ bestAsk: 0.45, bestAskSizeUsd: 200 }),
      }],
    ]);
    // allInCost = (0.45+0.45)*1.02 = 0.918
    // edgeBps = (1-0.918)*10000 = 820 bps
    const result = scanPairCostOpportunities(markets, orderbooks, DEFAULT_CONFIG);
    expect(result).toHaveLength(1);
    expect(result[0].conditionId).toBe('cid-1');
    expect(result[0].yesPrice).toBe(0.45);
    expect(result[0].noPrice).toBe(0.45);
    expect(result[0].rawCost).toBeCloseTo(0.9);
    expect(result[0].allInCost).toBeCloseTo(0.918);
    expect(result[0].edgeBps).toBeCloseTo(820);
    expect(result[0].maxSizeUsd).toBe(100);
  });

  it('uses per-market feeRate when available', () => {
    const markets = [makeMarket({ feeRate: 0.01 })];
    const orderbooks = new Map([
      ['cid-1', {
        yes: makeBook({ bestAsk: 0.50, bestAskSizeUsd: 100 }),
        no: makeBook({ bestAsk: 0.49, bestAskSizeUsd: 100 }),
      }],
    ]);
    // allInCost = (0.50+0.49)*1.01 = 0.9999
    // edgeBps = (1-0.9999)*10000 = 1 bps → below 50 bps min, skipped
    expect(scanPairCostOpportunities(markets, orderbooks, DEFAULT_CONFIG)).toEqual([]);
  });

  it('returns multiple opportunities sorted by edgeBps descending', () => {
    const markets = [
      makeMarket({ conditionId: 'cid-1', slug: 'market-1' }),
      makeMarket({ conditionId: 'cid-2', slug: 'market-2' }),
    ];
    const orderbooks = new Map([
      ['cid-1', {
        yes: makeBook({ bestAsk: 0.48, bestAskSizeUsd: 100 }),
        no: makeBook({ bestAsk: 0.48, bestAskSizeUsd: 100 }),
      }],
      ['cid-2', {
        yes: makeBook({ bestAsk: 0.40, bestAskSizeUsd: 100 }),
        no: makeBook({ bestAsk: 0.40, bestAskSizeUsd: 100 }),
      }],
    ]);
    // cid-1: allInCost = (0.48+0.48)*1.02 = 0.9792, edge = 208 bps
    // cid-2: allInCost = (0.40+0.40)*1.02 = 0.816, edge = 1840 bps
    const result = scanPairCostOpportunities(markets, orderbooks, DEFAULT_CONFIG);
    expect(result).toHaveLength(2);
    expect(result[0].conditionId).toBe('cid-2'); // highest edge first
    expect(result[1].conditionId).toBe('cid-1');
  });
});
