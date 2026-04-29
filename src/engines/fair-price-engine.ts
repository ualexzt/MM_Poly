import { FairPriceWeights } from '../types/config';
import { computeMidpoint, microprice } from '../utils/math';

export interface FairPriceInputs {
  bestBid: number;
  bestAsk: number;
  bestBidSize: number;
  bestAskSize: number;
  lastTradeEma: number | null;
  /** midpoint of the COMPLEMENT token (e.g. NO midpoint when computing YES fair price) */
  complementMidpoint: number | null;
  weights: FairPriceWeights;
}

export interface FairPriceResult {
  fairPrice: number;
  microprice: number;
}

/**
 * Computes weighted fair price.
 * - Complement-implied price for YES = 1 - no_midpoint (§7.4)
 * - Weights are renormalised when optional inputs are absent (§7.2)
 */
export function computeFairPrice(inputs: FairPriceInputs): FairPriceResult | null {
  const { bestBid, bestAsk, bestBidSize, bestAskSize, lastTradeEma, complementMidpoint, weights } = inputs;

  // Both sides required (§7.3)
  if (!bestBid || !bestAsk || bestBid <= 0 || bestAsk <= 0) {
    return null;
  }

  const mid = computeMidpoint(bestBid, bestAsk);
  const mic = microprice(bestBid, bestAsk, bestBidSize, bestAskSize);

  // M2 fix: complement-implied price = 1 - complement_midpoint (§7.4)
  const complementImplied = complementMidpoint !== null ? 1 - complementMidpoint : null;

  // M1 fix: renormalise weights for present inputs only
  let totalWeight = weights.microprice + weights.midpoint;
  let fair = weights.microprice * mic + weights.midpoint * mid;

  if (weights.complement > 0 && complementImplied !== null) {
    fair += weights.complement * complementImplied;
    totalWeight += weights.complement;
  }

  if (weights.lastTradeEma > 0 && lastTradeEma !== null) {
    fair += weights.lastTradeEma * lastTradeEma;
    totalWeight += weights.lastTradeEma;
  }

  // Normalise so weights always sum to 1.0
  if (totalWeight > 0 && totalWeight < 1.0) {
    fair = fair / totalWeight;
  }

  return { fairPrice: fair, microprice: mic };
}

/**
 * Checks that yes_fair + no_fair ≈ 1.0 within tolerance (§7.4).
 * toleranceCents is in cents (e.g. 2.0 means 0.02 in price space).
 */
export function checkComplementConsistency(yesFair: number, noFair: number, toleranceCents: number): boolean {
  const diffCents = Math.abs(yesFair + noFair - 1.0) * 100;
  return diffCents <= toleranceCents;
}
