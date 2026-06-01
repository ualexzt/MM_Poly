import { computeWeightedMidPrice, RollingMarketStats } from '../../src/strategy/micro-gabagool-rolling-stats';

describe('computeWeightedMidPrice', () => {
  it('computes WMP from bid/ask prices and USD sizes', () => {
    expect(computeWeightedMidPrice({ bestBid: 0.40, bestAsk: 0.44, bestBidSizeUsd: 20, bestAskSizeUsd: 10 })).toBeCloseTo(0.4266666667, 6);
  });

  it('returns midpoint when both top sizes are zero', () => {
    expect(computeWeightedMidPrice({ bestBid: 0.40, bestAsk: 0.44, bestBidSizeUsd: 0, bestAskSizeUsd: 0 })).toBeCloseTo(0.42, 6);
  });
});

describe('RollingMarketStats', () => {
  it('returns zero deltas for first sample', () => {
    const stats = new RollingMarketStats();

    const result = stats.update('m1', { timestampMs: 0, bestBid: 0.40, bestAsk: 0.44, bestBidSizeUsd: 20, bestAskSizeUsd: 10 });

    expect(result.wmpDelta3Min).toBe(0);
    expect(result.spreadChangesLast60Sec).toBe(0);
  });

  it('computes absolute WMP delta against a sample at 3 minutes ago', () => {
    const stats = new RollingMarketStats();
    stats.update('m1', { timestampMs: 0, bestBid: 0.40, bestAsk: 0.44, bestBidSizeUsd: 20, bestAskSizeUsd: 10 });

    const result = stats.update('m1', { timestampMs: 180_000, bestBid: 0.43, bestAsk: 0.47, bestBidSizeUsd: 20, bestAskSizeUsd: 10 });

    expect(result.wmpDelta3Min).toBeGreaterThan(0.02);
  });

  it('counts spread changes in the last 60 seconds', () => {
    const stats = new RollingMarketStats();
    stats.update('m1', { timestampMs: 0, bestBid: 0.40, bestAsk: 0.44, bestBidSizeUsd: 20, bestAskSizeUsd: 10 });
    stats.update('m1', { timestampMs: 30_000, bestBid: 0.40, bestAsk: 0.45, bestBidSizeUsd: 20, bestAskSizeUsd: 10 });

    const result = stats.update('m1', { timestampMs: 50_000, bestBid: 0.40, bestAsk: 0.46, bestBidSizeUsd: 20, bestAskSizeUsd: 10 });

    expect(result.spreadChangesLast60Sec).toBe(2);
  });
});
