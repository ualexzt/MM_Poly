import { QuoteDecisionTrace } from '../types/accounting';
import { Side } from '../types/quote';

export interface TraceInputs {
  mode: 'paper' | 'shadow' | 'small_live' | 'disabled';
  conditionId: string;
  tokenId: string;
  side: Side;
  bestBid: number | null;
  bestAsk: number | null;
  midpoint?: number | null;
  spreadTicks: number | null;
  fairPrice: number | null;
  microprice: number | null;
  complementFair: number | null;
  lastTradeEma: number | null;
  toxicityScore: number;
  inventoryPct: number;
  inventorySkewCents: number;
  targetPrice?: number;
  targetSizeUsd?: number;
  decision: 'quote' | 'skip' | 'cancel' | 'exit_only' | 'disabled_by_risk';
  reason: string;
  riskFlags: string[];
}

export function createTrace(inputs: TraceInputs): QuoteDecisionTrace {
  const midpoint = inputs.midpoint !== undefined
    ? inputs.midpoint
    : (inputs.bestBid !== null && inputs.bestAsk !== null
        ? (inputs.bestBid + inputs.bestAsk) / 2
        : null);
  return {
    timestampMs: Date.now(),
    ...inputs,
    midpoint,
    expectedSpreadCaptureCents: undefined,
    expectedRebateScore: undefined,
    expectedRewardScore: undefined
  };
}
