import { DEFAULT_CONFIG } from '../../src/strategy/micro-gabagool-config';

describe('MicroGabagoolConfig', () => {
  it('should have safe defaults for 15 USDC balance', () => {
    expect(DEFAULT_CONFIG.mode).toBe('paper');
    expect(DEFAULT_CONFIG.enableLiveTrading).toBe(false);
    expect(DEFAULT_CONFIG.initialBalanceUsd).toBe(15.0);
    expect(DEFAULT_CONFIG.activeTradingCapitalUsd).toBe(10.0);
    expect(DEFAULT_CONFIG.reserveBalanceUsd).toBe(5.0);
  });

  it('should have correct tick size', () => {
    expect(DEFAULT_CONFIG.tickSize).toBe(0.01);
  });

  it('should have risk limits', () => {
    expect(DEFAULT_CONFIG.maxDailyLossUsd).toBe(1.50);
    expect(DEFAULT_CONFIG.consecutiveLossLimit).toBe(3);
    expect(DEFAULT_CONFIG.maxTotalExposureUsd).toBe(6.0);
  });

  it('should have market filters', () => {
    expect(DEFAULT_CONFIG.minSpread).toBe(0.02);
    expect(DEFAULT_CONFIG.maxSpread).toBe(0.05);
    expect(DEFAULT_CONFIG.minBid).toBe(0.08);
    expect(DEFAULT_CONFIG.maxAsk).toBe(0.92);
    expect(DEFAULT_CONFIG.minTimeToSettlementMinutes).toBe(15);
  });

  it('should have scoring threshold', () => {
    expect(DEFAULT_CONFIG.minScoreToTrade).toBe(7.5);
  });

  it('should have timing parameters', () => {
    expect(DEFAULT_CONFIG.maxOrderAgeSeconds).toBe(45);
    expect(DEFAULT_CONFIG.maxPositionAgeSeconds).toBe(300);
    expect(DEFAULT_CONFIG.defensiveExitTimeoutSeconds).toBe(600);
  });

  it('should have gas and fee parameters', () => {
    expect(DEFAULT_CONFIG.gasPerRoundtripEstimateUsd).toBe(0.004);
    expect(DEFAULT_CONFIG.makerRebateRate).toBe(0.001);
    expect(DEFAULT_CONFIG.minProfitThresholdUsd).toBe(0.005);
  });
});
