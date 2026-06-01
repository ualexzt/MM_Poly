export interface ScoringInputs {
  spread: number;
  bestBidSizeUsd: number;
  bestAskSizeUsd: number;
  wmpDelta3Min: number;
  spreadChangesLast60Sec: number;
  timeToSettlementMin: number;
}

export interface ScoringResult {
  totalScore: number;
  spreadScore: number;
  liquidityScore: number;
  volatilityScore: number;
  orderbookScore: number;
  settlementScore: number;
  passThreshold: boolean;
}

function computeSpreadScore(spread: number): number {
  if (spread >= 0.02 && spread <= 0.03) return 10;
  if (spread > 0.03 && spread <= 0.04) return 8;
  if (spread > 0.04 && spread <= 0.05) return 5;
  return 0;
}

function computeLiquidityScore(minSizeUsd: number): number {
  if (minSizeUsd >= 10.0) return 10;
  if (minSizeUsd >= 5.0) return minSizeUsd;
  return 0;
}

function computeVolatilityScore(wmpDelta: number): number {
  if (wmpDelta >= 0.01 && wmpDelta <= 0.05) return 10;
  if (wmpDelta < 0.01) return 5;
  return 0;
}

function computeOrderbookScore(spreadChanges: number): number {
  if (spreadChanges <= 1) return 10;
  if (spreadChanges <= 3) return 5;
  return 0;
}

function computeSettlementScore(minutesToSettlement: number): number {
  if (minutesToSettlement >= 60) return 10;
  if (minutesToSettlement >= 15) return 6;
  return 0;
}

export function computeOpportunityScore(inputs: ScoringInputs, minScore: number = 7.5): ScoringResult {
  const spreadScore = computeSpreadScore(inputs.spread);
  const liquidityScore = computeLiquidityScore(Math.min(inputs.bestBidSizeUsd, inputs.bestAskSizeUsd));
  const volatilityScore = computeVolatilityScore(inputs.wmpDelta3Min);
  const orderbookScore = computeOrderbookScore(inputs.spreadChangesLast60Sec);
  const settlementScore = computeSettlementScore(inputs.timeToSettlementMin);

  const totalScore = 
    0.35 * spreadScore +
    0.25 * liquidityScore +
    0.20 * volatilityScore +
    0.10 * orderbookScore +
    0.10 * settlementScore;

  return {
    totalScore,
    spreadScore,
    liquidityScore,
    volatilityScore,
    orderbookScore,
    settlementScore,
    passThreshold: totalScore >= minScore,
  };
}
