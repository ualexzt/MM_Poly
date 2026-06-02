export interface PairCostAnalyticsSummaryBucket {
  totalSnapshots: number;
  opportunitySnapshots: number;
  opportunityRate: number;
  allPairCostMin: number | null;
  allPairCostP50: number | null;
  allPairCostP90: number | null;
  allEdgeMax: number | null;
  pairCostP50: number | null;
  pairCostP90: number | null;
  edgeP50: number | null;
}

export interface PairCostAnalyticsSummary extends PairCostAnalyticsSummaryBucket {
  bySampleUsd: Record<string, PairCostAnalyticsSummaryBucket>;
}

function numeric(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function percentile(values: number[], pct: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((pct / 100) * sorted.length) - 1);
  return sorted[index];
}

function emptyBucket(): PairCostAnalyticsSummaryBucket {
  return {
    totalSnapshots: 0,
    opportunitySnapshots: 0,
    opportunityRate: 0,
    allPairCostMin: null,
    allPairCostP50: null,
    allPairCostP90: null,
    allEdgeMax: null,
    pairCostP50: null,
    pairCostP90: null,
    edgeP50: null,
  };
}

function finalizeBucket(
  bucket: PairCostAnalyticsSummaryBucket,
  opportunityPairCosts: number[],
  opportunityEdges: number[],
  allPairCosts: number[],
  allEdges: number[],
): PairCostAnalyticsSummaryBucket {
  return {
    ...bucket,
    opportunityRate: bucket.totalSnapshots > 0 ? bucket.opportunitySnapshots / bucket.totalSnapshots : 0,
    allPairCostMin: allPairCosts.length > 0 ? Math.min(...allPairCosts) : null,
    allPairCostP50: percentile(allPairCosts, 50),
    allPairCostP90: percentile(allPairCosts, 90),
    allEdgeMax: allEdges.length > 0 ? Math.max(...allEdges) : null,
    pairCostP50: percentile(opportunityPairCosts, 50),
    pairCostP90: percentile(opportunityPairCosts, 90),
    edgeP50: percentile(opportunityEdges, 50),
  };
}

export function summarizePairCostAnalyticsEvents(events: Record<string, unknown>[]): PairCostAnalyticsSummary {
  const total = emptyBucket();
  const totalPairCosts: number[] = [];
  const totalEdges: number[] = [];
  const totalAllPairCosts: number[] = [];
  const totalAllEdges: number[] = [];
  const bucketData = new Map<string, { bucket: PairCostAnalyticsSummaryBucket; pairCosts: number[]; edges: number[]; allPairCosts: number[]; allEdges: number[] }>();

  for (const event of events) {
    if (event.eventType !== 'pair_cost_executable_snapshot') continue;

    const sampleUsd = numeric(event.sampleUsd);
    const key = sampleUsd === null ? 'unknown' : String(sampleUsd);
    const data = bucketData.get(key) ?? { bucket: emptyBucket(), pairCosts: [], edges: [], allPairCosts: [], allEdges: [] };
    bucketData.set(key, data);

    total.totalSnapshots += 1;
    data.bucket.totalSnapshots += 1;

    const snapshotPairCost = numeric(event.pairCost);
    const snapshotEdge = numeric(event.edgePerPair);
    if (snapshotPairCost !== null) {
      totalAllPairCosts.push(snapshotPairCost);
      data.allPairCosts.push(snapshotPairCost);
    }
    if (snapshotEdge !== null) {
      totalAllEdges.push(snapshotEdge);
      data.allEdges.push(snapshotEdge);
    }

    if (event.opportunity === true) {
      const pairCost = numeric(event.pairCost);
      const edge = numeric(event.edgePerPair);
      total.opportunitySnapshots += 1;
      data.bucket.opportunitySnapshots += 1;
      if (pairCost !== null) {
        totalPairCosts.push(pairCost);
        data.pairCosts.push(pairCost);
      }
      if (edge !== null) {
        totalEdges.push(edge);
        data.edges.push(edge);
      }
    }
  }

  const bySampleUsd: Record<string, PairCostAnalyticsSummaryBucket> = {};
  for (const [key, data] of bucketData.entries()) {
    bySampleUsd[key] = finalizeBucket(data.bucket, data.pairCosts, data.edges, data.allPairCosts, data.allEdges);
  }

  return {
    ...finalizeBucket(total, totalPairCosts, totalEdges, totalAllPairCosts, totalAllEdges),
    bySampleUsd,
  };
}
