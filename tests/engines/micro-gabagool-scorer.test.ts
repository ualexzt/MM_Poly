import { computeOpportunityScore, ScoringInputs } from '../../src/engines/micro-gabagool-scorer';

describe('computeOpportunityScore', () => {
  function idealInputs(overrides?: Partial<ScoringInputs>): ScoringInputs {
    return {
      spread: 0.025,
      bestBidSizeUsd: 50,
      bestAskSizeUsd: 50,
      wmpDelta3Min: 0.03,
      spreadChangesLast60Sec: 0,
      timeToSettlementMin: 120,
      ...overrides,
    };
  }

  it('should score ideal market at 10', () => {
    const result = computeOpportunityScore(idealInputs());
    expect(result.totalScore).toBe(10);
    expect(result.passThreshold).toBe(true);
  });

  it('should reject spread < 0.02', () => {
    const result = computeOpportunityScore(idealInputs({ spread: 0.015 }));
    expect(result.spreadScore).toBe(0);
    expect(result.passThreshold).toBe(false);
  });

  it('should reject spread > 0.05', () => {
    const result = computeOpportunityScore(idealInputs({ spread: 0.06 }));
    expect(result.spreadScore).toBe(0);
    expect(result.passThreshold).toBe(false);
  });

  it('should score spread 0.03-0.04 at 8', () => {
    const result = computeOpportunityScore(idealInputs({ spread: 0.035 }));
    expect(result.spreadScore).toBe(8);
  });

  it('should score spread 0.04-0.05 at 5', () => {
    const result = computeOpportunityScore(idealInputs({ spread: 0.045 }));
    expect(result.spreadScore).toBe(5);
  });

  it('should score spread 0.02-0.03 at 10', () => {
    const result = computeOpportunityScore(idealInputs({ spread: 0.025 }));
    expect(result.spreadScore).toBe(10);
  });

  it('should reject thin liquidity < 5', () => {
    const result = computeOpportunityScore(idealInputs({ bestBidSizeUsd: 3 }));
    expect(result.liquidityScore).toBe(0);
  });

  it('should score liquidity linearly 5-10', () => {
    const result = computeOpportunityScore(idealInputs({ bestBidSizeUsd: 7, bestAskSizeUsd: 20 }));
    expect(result.liquidityScore).toBe(7);
  });

  it('should score liquidity 10 at 10', () => {
    const result = computeOpportunityScore(idealInputs({ bestBidSizeUsd: 10, bestAskSizeUsd: 50 }));
    expect(result.liquidityScore).toBe(10);
  });

  it('should score zero volatility at 5', () => {
    const result = computeOpportunityScore(idealInputs({ wmpDelta3Min: 0 }));
    expect(result.volatilityScore).toBe(5);
  });

  it('should score working volatility at 10', () => {
    const result = computeOpportunityScore(idealInputs({ wmpDelta3Min: 0.03 }));
    expect(result.volatilityScore).toBe(10);
  });

  it('should reject toxic volatility > 0.05', () => {
    const result = computeOpportunityScore(idealInputs({ wmpDelta3Min: 0.08 }));
    expect(result.volatilityScore).toBe(0);
  });

  it('should score stable orderbook at 10', () => {
    const result = computeOpportunityScore(idealInputs({ spreadChangesLast60Sec: 0 }));
    expect(result.orderbookScore).toBe(10);
  });

  it('should score slightly unstable orderbook at 5', () => {
    const result = computeOpportunityScore(idealInputs({ spreadChangesLast60Sec: 2 }));
    expect(result.orderbookScore).toBe(5);
  });

  it('should reject unstable orderbook', () => {
    const result = computeOpportunityScore(idealInputs({ spreadChangesLast60Sec: 5 }));
    expect(result.orderbookScore).toBe(0);
  });

  it('should score settlement >= 60 min at 10', () => {
    const result = computeOpportunityScore(idealInputs({ timeToSettlementMin: 120 }));
    expect(result.settlementScore).toBe(10);
  });

  it('should score settlement 15-60 min at 6', () => {
    const result = computeOpportunityScore(idealInputs({ timeToSettlementMin: 30 }));
    expect(result.settlementScore).toBe(6);
  });

  it('should reject settlement < 15 min', () => {
    const result = computeOpportunityScore(idealInputs({ timeToSettlementMin: 10 }));
    expect(result.settlementScore).toBe(0);
  });

  it('should pass threshold at 7.5', () => {
    const result = computeOpportunityScore(idealInputs({
      spread: 0.035,       // 8 * 0.35 = 2.8
      bestBidSizeUsd: 10,  // 10 * 0.25 = 2.5
      bestAskSizeUsd: 10,
      wmpDelta3Min: 0.03,  // 10 * 0.20 = 2.0
      spreadChangesLast60Sec: 0, // 10 * 0.10 = 1.0
      timeToSettlementMin: 30,   // 6 * 0.10 = 0.6
    }));
    expect(result.totalScore).toBeCloseTo(8.9, 1);
    expect(result.passThreshold).toBe(true);
  });

  it('should fail threshold below 7.5', () => {
    const result = computeOpportunityScore(idealInputs({
      spread: 0.045,       // 5 * 0.35 = 1.75
      bestBidSizeUsd: 7,   // 7 * 0.25 = 1.75
      bestAskSizeUsd: 7,
      wmpDelta3Min: 0.005, // 5 * 0.20 = 1.0
      spreadChangesLast60Sec: 2, // 5 * 0.10 = 0.5
      timeToSettlementMin: 30,   // 6 * 0.10 = 0.6
    }), 7.5);
    expect(result.totalScore).toBeCloseTo(5.6, 1);
    expect(result.passThreshold).toBe(false);
  });
});
