import { filterEligibleMarkets, isMarketEligible } from '../../src/strategy/market-selector';
import { defaultConfig } from '../../src/strategy/config';
import { MarketState } from '../../src/types/market';
import { MarketFilterConfig } from '../../src/types/config';
import type { BookState } from '../../src/types/book';

function makeMarket(overrides: Partial<MarketState> = {}): MarketState {
  return {
    conditionId: 'c1', yesTokenId: 'y1', noTokenId: 'n1',
    active: true, closed: false, enableOrderBook: true, feesEnabled: true,
    volume24hUsd: 20000, liquidityUsd: 10000,
    oracleAmbiguityScore: 0.10,
    resolutionSource: 'https://foo.com',
    ...overrides
  };
}

const config: MarketFilterConfig = {
  active: true, closed: false, enableOrderBook: true, feesEnabled: true,
  midpointMin: 0.15, midpointMax: 0.85,
  minVolume24hUsd: 10000, minLiquidityUsd: 5000,
  minBestLevelDepthUsd: 100, minDepth3LevelsUsd: 500,
  minSpreadTicks: 3, maxSpreadCents: 8,
  minTimeToResolutionMinutes: 90, disableNearResolutionMinutes: 30,
  maxOracleAmbiguityScore: 0.20, requireValidResolutionSource: true,
  rejectPathologicalWideBooks: true,
  pathologicalBestBidLte: 0.001,
  pathologicalBestAskGte: 0.999,
  maxMinOrderExposurePct: 20,
};

function makeBook(overrides: Partial<BookState> = {}): BookState {
  return {
    tokenId: 'y1', conditionId: 'c1',
    bids: [{ price: 0.24, size: 100, sizeUsd: 24 }],
    asks: [{ price: 0.30, size: 100, sizeUsd: 30 }],
    bestBid: 0.24, bestAsk: 0.30,
    bestBidSizeUsd: 24, bestAskSizeUsd: 30,
    midpoint: 0.27, spread: 0.06, spreadTicks: 6,
    depth1Usd: 154, depth3Usd: 500,
    tickSize: 0.01, minOrderSize: 5,
    lastUpdateMs: Date.now(),
    ...overrides,
  };
}

describe('market-selector', () => {
  test('rejects closed market', () => {
    const markets = [makeMarket({ closed: true })];
    expect(filterEligibleMarkets(markets, config)).toHaveLength(0);
  });

  test('rejects market without orderbook', () => {
    const markets = [makeMarket({ enableOrderBook: false })];
    expect(filterEligibleMarkets(markets, config)).toHaveLength(0);
  });

  test('rejects fee disabled market', () => {
    const markets = [makeMarket({ feesEnabled: false })];
    expect(filterEligibleMarkets(markets, config)).toHaveLength(0);
  });

  test('rejects low liquidity market', () => {
    const markets = [makeMarket({ liquidityUsd: 1000 })];
    expect(filterEligibleMarkets(markets, config)).toHaveLength(0);
  });

  test('accepts valid fee enabled market', () => {
    const markets = [makeMarket()];
    expect(filterEligibleMarkets(markets, config)).toHaveLength(1);
  });

  test('rejects pathological 0.001 x 0.999 books', () => {
    const books = new Map<string, BookState>([
      ['y1', makeBook({
        bestBid: 0.001,
        bestAsk: 0.999,
        midpoint: 0.5,
        spread: 0.998,
        spreadTicks: 998,
        bestBidSizeUsd: 0.1,
        bestAskSizeUsd: 0.1,
        depth1Usd: 0.2,
        depth3Usd: 0.5,
        tickSize: 0.001,
      })],
    ]);

    expect(isMarketEligible(makeMarket(), {
      ...defaultConfig.marketFilter,
      minBestLevelDepthUsd: 0,
      minDepth3LevelsUsd: 0,
      maxSpreadCents: 100,
    }, books)).toBe(false);
  });

  test('rejects when min order consumes too much of live exposure budget', () => {
    const books = new Map<string, BookState>([
      ['y1', makeBook({ bestBid: 0.45, bestAsk: 0.55, midpoint: 0.5, minOrderSize: 5 })],
    ]);

    expect(isMarketEligible(makeMarket(), {
      ...defaultConfig.marketFilter,
      minBestLevelDepthUsd: 0,
      minDepth3LevelsUsd: 0,
      maxMinOrderExposurePct: 20,
    }, books)).toBe(false);
  });
});
