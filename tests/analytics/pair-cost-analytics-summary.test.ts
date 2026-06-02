import { summarizePairCostAnalyticsEvents } from '../../src/analytics/pair-cost-analytics-summary';

describe('summarizePairCostAnalyticsEvents', () => {
  it('summarizes opportunity pair-cost percentiles and skip-free snapshot counts', () => {
    const summary = summarizePairCostAnalyticsEvents([
      { eventType: 'pair_cost_executable_snapshot', sampleUsd: 1, opportunity: false, pairCost: 1.01, edgePerPair: -0.01 },
      { eventType: 'pair_cost_executable_snapshot', sampleUsd: 1, opportunity: true, pairCost: 0.98, edgePerPair: 0.02 },
      { eventType: 'pair_cost_executable_snapshot', sampleUsd: 1, opportunity: true, pairCost: 0.97, edgePerPair: 0.03 },
      { eventType: 'pair_cost_executable_snapshot', sampleUsd: 2, opportunity: true, pairCost: 0.99, edgePerPair: 0.01 },
    ]);

    expect(summary.totalSnapshots).toBe(4);
    expect(summary.opportunitySnapshots).toBe(3);
    expect(summary.opportunityRate).toBe(0.75);
    expect(summary.allPairCostMin).toBe(0.97);
    expect(summary.allPairCostP50).toBe(0.98);
    expect(summary.allPairCostP90).toBe(1.01);
    expect(summary.allEdgeMax).toBe(0.03);
    expect(summary.pairCostP50).toBe(0.98);
    expect(summary.pairCostP90).toBe(0.99);
    expect(summary.edgeP50).toBe(0.02);
    expect(summary.bySampleUsd).toEqual({
      '1': expect.objectContaining({ totalSnapshots: 3, opportunitySnapshots: 2 }),
      '2': expect.objectContaining({ totalSnapshots: 1, opportunitySnapshots: 1 }),
    });
  });

  it('returns null percentiles when there are no opportunities', () => {
    const summary = summarizePairCostAnalyticsEvents([
      { eventType: 'pair_cost_executable_snapshot', sampleUsd: 1, opportunity: false, pairCost: 1.01, edgePerPair: -0.01 },
    ]);

    expect(summary.opportunitySnapshots).toBe(0);
    expect(summary.allPairCostMin).toBe(1.01);
    expect(summary.allEdgeMax).toBe(-0.01);
    expect(summary.pairCostP50).toBeNull();
    expect(summary.pairCostP90).toBeNull();
    expect(summary.edgeP50).toBeNull();
  });
});
