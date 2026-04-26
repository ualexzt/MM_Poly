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
});
