import { defaultConfig } from '../../src/strategy/config';

describe('runtime invariants', () => {
  test('paper mode does not allow live orders', () => {
    expect(defaultConfig.mode).toBe('paper');
    expect(defaultConfig.liveTradingEnabled).toBe(false);
  });

  test('every config spread config is positive', () => {
    expect(defaultConfig.spread.baseHalfSpreadCents).toBeGreaterThan(0);
    expect(defaultConfig.spread.minHalfSpreadTicks).toBeGreaterThan(0);
  });

  test('inventory hard limit > soft limit', () => {
    expect(defaultConfig.inventory.hardLimitPct).toBeGreaterThan(defaultConfig.inventory.softLimitPct);
  });

  test('max quote lifetime >= min quote lifetime', () => {
    expect(defaultConfig.maxQuoteLifetimeMs).toBeGreaterThanOrEqual(defaultConfig.minQuoteLifetimeMs);
  });

  test('$30 guarded defaults are safe', () => {
    expect(defaultConfig.inventory.maxTotalStrategyExposureUsd).toBeLessThanOrEqual(25);
    expect(defaultConfig.inventory.maxMarketExposureUsd).toBeLessThanOrEqual(3);
    expect(defaultConfig.size.baseOrderSizeUsd).toBeLessThanOrEqual(1);
    expect(defaultConfig.size.maxOrderSizeUsd).toBeLessThanOrEqual(1.5);
    expect(defaultConfig.risk.maxDailyDrawdownUsd).toBeLessThanOrEqual(5);
  });
});
