/**
 * Classify a fill as adverse, neutral, or favorable (§13.3).
 * @param adverseThresholdCents - adverse_move_threshold_cents from config (default 1.0 cent = 0.01 price)
 */
export function classifyFill(
  side: 'BUY' | 'SELL',
  fillPrice: number,
  midpointAfter30s: number | null,
  adverseThresholdCents = 1.0
): 'adverse' | 'neutral' | 'favorable' {
  if (midpointAfter30s === null) return 'neutral';
  const threshold = adverseThresholdCents / 100;
  if (side === 'BUY' && midpointAfter30s < fillPrice - threshold) return 'adverse';
  if (side === 'SELL' && midpointAfter30s > fillPrice + threshold) return 'adverse';
  // Favorable: midpoint moved in our favour after fill
  if (side === 'BUY' && midpointAfter30s > fillPrice + threshold) return 'favorable';
  if (side === 'SELL' && midpointAfter30s < fillPrice - threshold) return 'favorable';
  return 'neutral';
}
