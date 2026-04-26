export function classifyFill(side: 'BUY' | 'SELL', fillPrice: number, midpointAfter30s: number | null): 'adverse' | 'neutral' | 'favorable' {
  if (midpointAfter30s === null) return 'neutral';
  if (side === 'BUY' && midpointAfter30s < fillPrice - 0.01) return 'adverse';
  if (side === 'SELL' && midpointAfter30s > fillPrice + 0.01) return 'adverse';
  return 'neutral';
}
