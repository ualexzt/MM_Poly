import { loadPairCostRuntimeConfig } from '../../src/config/pair-cost-runtime';

const EMPTY_ENV: NodeJS.ProcessEnv = {};

describe('loadPairCostRuntimeConfig', () => {
  it('defaults strategy and trading to fail closed', () => {
    const config = loadPairCostRuntimeConfig(EMPTY_ENV);

    expect(config.strategy.enabled).toBe(false);
    expect(config.strategy.probeEnabled).toBe(false);
    expect(config.strategy.allowProbeMode).toBe(false);
    expect(config.tradingEnabled).toBe(false);
    expect(config.maxMarkets).toBe(20);
  });

  it('parses pair-cost env values while keeping trading separately gated', () => {
    const config = loadPairCostRuntimeConfig({
      PAIR_COST_ENABLED: 'true',
      PAIR_COST_TRADING_ENABLED: 'false',
      PAIR_COST_MAX_MARKETS: '3',
      PAIR_COST_MAX_PAIR_COST: '0.981',
      PAIR_COST_MIN_EDGE_PER_PAIR: '0.019',
      PAIR_COST_MAX_SINGLE_ORDER_USD: '2.5',
      PAIR_COST_MAX_TOTAL_MARKET_EXPOSURE_USD: '7',
      PAIR_COST_MAX_UNPAIRED_EXPOSURE_USD: '1.5',
      PAIR_COST_ORDERBOOK_STALE_MS: '2500',
      PAIR_COST_NO_NEW_PAIR_LAST_SECONDS: '90',
    });

    expect(config.strategy.enabled).toBe(true);
    expect(config.tradingEnabled).toBe(false);
    expect(config.maxMarkets).toBe(3);
    expect(config.strategy.maxPairCost).toBe(0.981);
    expect(config.strategy.minEdgePerPair).toBe(0.019);
    expect(config.strategy.maxSingleOrderUsd).toBe(2.5);
    expect(config.strategy.maxTotalMarketExposureUsd).toBe(7);
    expect(config.strategy.maxUnpairedExposureUsd).toBe(1.5);
    expect(config.strategy.orderbookStaleMs).toBe(2500);
    expect(config.strategy.noNewPairLastSeconds).toBe(90);
  });

  it('requires explicit probe flags for probe mode', () => {
    const config = loadPairCostRuntimeConfig({
      PAIR_COST_PROBE_ENABLED: 'true',
      PAIR_COST_ALLOW_PROBE_MODE: 'false',
    });

    expect(config.strategy.probeEnabled).toBe(true);
    expect(config.strategy.allowProbeMode).toBe(false);
  });
});
