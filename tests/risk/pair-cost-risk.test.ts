import {
  checkRisk,
  RiskConfig,
} from '../../src/risk/pair-cost-risk';
import { Position } from '../../src/engines/accumulator';

const DEFAULT_RISK: RiskConfig = {
  maxExposureUsd: 12,
  maxExposurePerMarketUsd: 5,
  maxDrawdownPct: 0.20,
  maxOpenOrders: 4,
  startingBalanceUsd: 15,
};

function makePosition(overrides: Partial<Position> = {}): Position {
  return { yesQty: 0, noQty: 0, avgYesPrice: 0, avgNoPrice: 0, ...overrides };
}

describe('checkRisk', () => {
  it('allows when no exposure and no orders', () => {
    const result = checkRisk({
      config: DEFAULT_RISK,
      totalExposureUsd: 0,
      marketExposureUsd: 0,
      openOrderCount: 0,
      currentBalanceUsd: 15,
    });
    expect(result.allowed).toBe(true);
  });

  it('blocks when total exposure exceeds limit', () => {
    const result = checkRisk({
      config: DEFAULT_RISK,
      totalExposureUsd: 12.01,
      marketExposureUsd: 0,
      openOrderCount: 0,
      currentBalanceUsd: 15,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('total exposure');
  });

  it('blocks when market exposure exceeds limit', () => {
    const result = checkRisk({
      config: DEFAULT_RISK,
      totalExposureUsd: 5,
      marketExposureUsd: 5.01,
      openOrderCount: 0,
      currentBalanceUsd: 15,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('market exposure');
  });

  it('blocks when too many open orders', () => {
    const result = checkRisk({
      config: DEFAULT_RISK,
      totalExposureUsd: 5,
      marketExposureUsd: 3,
      openOrderCount: 5,
      currentBalanceUsd: 15,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('open orders');
  });

  it('blocks when drawdown exceeds limit', () => {
    const result = checkRisk({
      config: DEFAULT_RISK,
      totalExposureUsd: 5,
      marketExposureUsd: 3,
      openOrderCount: 2,
      currentBalanceUsd: 11.9, // drawdown = (15-11.9)/15 = 20.67%
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('drawdown');
  });

  it('allows when drawdown is within limit', () => {
    const result = checkRisk({
      config: DEFAULT_RISK,
      totalExposureUsd: 5,
      marketExposureUsd: 3,
      openOrderCount: 2,
      currentBalanceUsd: 12.1, // drawdown = (15-12.1)/15 = 19.3%
    });
    expect(result.allowed).toBe(true);
  });

  it('allows at exactly the exposure limit', () => {
    const result = checkRisk({
      config: DEFAULT_RISK,
      totalExposureUsd: 12,
      marketExposureUsd: 5,
      openOrderCount: 4,
      currentBalanceUsd: 15,
    });
    expect(result.allowed).toBe(true);
  });
});
