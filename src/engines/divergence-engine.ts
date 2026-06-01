import { MomentumSignal } from './momentum-engine';

export interface DivergenceConfig {
  minDivergencePct: number;
  minEvPct: number;
  maxEntryPrice: number;
  minEntryPrice: number;
}

export interface MarketSnapshot {
  yesPrice: number;
  noPrice: number;
  midpoint: number;
  spread: number;
  timestamp: number;
}

export type TradeAction = 'BUY_YES' | 'BUY_NO' | 'NO_ACTION';

export interface DivergenceSignal {
  action: TradeAction;
  divergencePct: number;
  expectedValue: number;
  expectedValuePct: number;
  entryPrice: number;
  confidence: number;
  rejectionReason?: string;
  timestamp: number;
}

/**
 * Pure function: analyzes divergence between momentum signal and market prices.
 * No side effects, no constructor-held state.
 */
export function analyzeDivergence(
  config: DivergenceConfig,
  momentum: MomentumSignal,
  market: MarketSnapshot,
  nowFn: () => number = Date.now
): DivergenceSignal {
  // Skip neutral momentum
  if (momentum.direction === 'NEUTRAL') {
    return noAction(0, 0, 'neutral_momentum', nowFn());
  }

  // Determine which side to buy based on momentum
  const isBullish = momentum.direction === 'BULLISH';
  const entryPrice = isBullish ? market.yesPrice : market.noPrice;

  // Check entry price range
  if (entryPrice > config.maxEntryPrice) {
    return noAction(0, entryPrice, 'entry_price_too_high', nowFn());
  }
  if (entryPrice < config.minEntryPrice) {
    return noAction(0, entryPrice, 'entry_price_too_low', nowFn());
  }

  // Calculate implied probability from momentum
  const impliedProbability = estimateProbability(momentum);

  // Calculate divergence
  const divergencePct = ((impliedProbability - entryPrice) / entryPrice) * 100;

  // Check minimum divergence
  if (divergencePct < config.minDivergencePct) {
    return noAction(divergencePct, entryPrice, 'divergence_too_small', nowFn());
  }

  // Calculate Expected Value
  const payout = 1.0;
  const expectedValue = (impliedProbability * payout) - entryPrice;
  const expectedValuePct = (expectedValue / entryPrice) * 100;

  // Check minimum EV
  if (expectedValuePct < config.minEvPct) {
    return noAction(divergencePct, entryPrice, 'ev_too_low', nowFn());
  }

  // Calculate confidence
  const confidence = calculateConfidence(momentum, divergencePct);

  return {
    action: isBullish ? 'BUY_YES' : 'BUY_NO',
    divergencePct,
    expectedValue,
    expectedValuePct,
    entryPrice,
    confidence,
    timestamp: nowFn()
  };
}

function estimateProbability(momentum: MomentumSignal): number {
  // Base probability from momentum strength
  const baseProbability = 0.50;

  // Add momentum adjustment (0-20% based on strength)
  const momentumAdjustment = momentum.strength * 0.20;

  // Add volume confirmation bonus
  const volumeBonus = momentum.volumeConfirmed ? 0.05 : 0;

  // Add EMA trend bonus
  const emaAligned =
    (momentum.direction === 'BULLISH' && momentum.emaFast > momentum.emaSlow) ||
    (momentum.direction === 'BEARISH' && momentum.emaFast < momentum.emaSlow);
  const emaTrend = emaAligned ? 0.05 : -0.05;

  // Total probability (capped at 0.85 to be conservative)
  return Math.min(0.85,
    baseProbability + momentumAdjustment + volumeBonus + emaTrend
  );
}

function calculateConfidence(momentum: MomentumSignal, divergencePct: number): number {
  const strengthWeight = 0.4;
  const volumeWeight = 0.3;
  const divergenceWeight = 0.3;

  const strengthScore = momentum.strength;
  const volumeScore = momentum.volumeConfirmed ? 1 : 0;
  const divergenceScore = Math.min(1, divergencePct / 10);

  return (
    strengthScore * strengthWeight +
    volumeScore * volumeWeight +
    divergenceScore * divergenceWeight
  );
}

function noAction(divergencePct: number, entryPrice: number, reason: string, timestamp: number): DivergenceSignal {
  return {
    action: 'NO_ACTION',
    divergencePct,
    expectedValue: 0,
    expectedValuePct: 0,
    entryPrice,
    confidence: 0,
    rejectionReason: reason,
    timestamp
  };
}
