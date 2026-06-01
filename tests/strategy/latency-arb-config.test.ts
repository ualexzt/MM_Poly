import { defaultLatencyArbConfig } from '../../src/strategy/latency-arb-config';

describe('defaultLatencyArbConfig live-like shadow fields', () => {
  it('should default to BTC 15m shadow soak settings', () => {
    expect(defaultLatencyArbConfig.marketAsset).toBe('BTC');
    expect(defaultLatencyArbConfig.marketDurationMinutes).toBe(15);
    expect(defaultLatencyArbConfig.startingBalanceUsd).toBe(15.48);
    expect(defaultLatencyArbConfig.orderBalanceFraction).toBe(0.1);
    expect(defaultLatencyArbConfig.maxOrderSizeUsd).toBe(1.55);
    expect(defaultLatencyArbConfig.maxSpreadCents).toBe(8);
    expect(defaultLatencyArbConfig.maxMarketAgeMs).toBe(2000);
    expect(defaultLatencyArbConfig.simulatedLatencyMs).toBe(750);
    expect(defaultLatencyArbConfig.logDir).toBe('logs');
  });
});

describe('latency arb env validation', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
  });

  function loadEnvWith(overrides: Record<string, string>) {
    process.env = { ...originalEnv, ...overrides };
    return require('../../src/config/env').env;
  }

  it('should parse valid latency arb shadow settings', () => {
    const env = loadEnvWith({
      LATENCY_ARB_MARKET_DURATION_MINUTES: '15',
      LATENCY_ARB_STARTING_BALANCE_USD: '15.48',
      LATENCY_ARB_ORDER_BALANCE_FRACTION: '0.10',
      LATENCY_ARB_MAX_ORDER_SIZE_USD: '1.55',
      LATENCY_ARB_MAX_SPREAD_CENTS: '8',
      LATENCY_ARB_MAX_MARKET_AGE_MS: '2000',
      LATENCY_ARB_SIMULATED_LATENCY_MS: '750',
      LATENCY_ARB_LOG_DIR: 'logs',
    });

    expect(env.latencyArbOrderBalanceFraction).toBe(0.1);
    expect(env.latencyArbMaxMarketAgeMs).toBe(2000);
  });

  it.each([
    ['LATENCY_ARB_MARKET_DURATION_MINUTES', '0'],
    ['LATENCY_ARB_STARTING_BALANCE_USD', '0'],
    ['LATENCY_ARB_ORDER_BALANCE_FRACTION', '0'],
    ['LATENCY_ARB_ORDER_BALANCE_FRACTION', '1.01'],
    ['LATENCY_ARB_MAX_ORDER_SIZE_USD', '0'],
    ['LATENCY_ARB_MAX_SPREAD_CENTS', '-1'],
    ['LATENCY_ARB_MAX_MARKET_AGE_MS', '-1'],
    ['LATENCY_ARB_SIMULATED_LATENCY_MS', '-1'],
    ['LATENCY_ARB_LOG_DIR', ''],
  ])('should reject invalid %s=%s', (key, value) => {
    expect(() => loadEnvWith({ [key]: value })).toThrow(key);
  });
});
