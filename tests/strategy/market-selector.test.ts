import { filterEligibleMarkets } from '../../src/strategy/market-selector';
import { MarketState } from '../../src/types/market';
import { MarketFilterConfig } from '../../src/types/config';

function makeMarket(overrides: Partial<MarketState> = {}): MarketState {
  return {
    conditionId: 'c1', yesTokenId: 'y1', noTokenId: 'n1',
    active: true, closed: false, enableOrderBook: true, feesEnabled: true,
    volume24hUsd: 20000, liquidityUsd: 10000,
    oracleAmbiguityScore: 0.10,
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
  maxOracleAmbiguityScore: 0.20, requireValidResolutionSource: true
};

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
});
