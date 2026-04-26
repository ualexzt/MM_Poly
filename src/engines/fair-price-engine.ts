import { FairPriceWeights } from '../types/config';
import { computeMidpoint, microprice } from '../utils/math';

export interface FairPriceInputs {
  bestBid: number;
  bestAsk: number;
  bestBidSize: number;
  bestAskSize: number;
  lastTradeEma: number | null;
  complementMidpoint: number | null;
  weights: FairPriceWeights;
}

export interface FairPriceResult {
  fairPrice: number;
  microprice: number;
}

export function computeFairPrice(inputs: FairPriceInputs): FairPriceResult | null {
  const { bestBid, bestAsk, bestBidSize, bestAskSize, lastTradeEma, complementMidpoint, weights } = inputs;

  if (!bestBid || !bestAsk || bestBid <= 0 || bestAsk <= 0) {
    return null;
  }

  const mid = computeMidpoint(bestBid, bestAsk);
  const mic = microprice(bestBid, bestAsk, bestBidSize, bestAskSize);

  let fair = weights.microprice * mic + weights.midpoint * mid;

  if (weights.complement > 0 && complementMidpoint !== null) {
    fair += weights.complement * complementMidpoint;
  }

  if (weights.lastTradeEma > 0 && lastTradeEma !== null) {
    fair += weights.lastTradeEma * lastTradeEma;
  }

  return { fairPrice: fair, microprice: mic };
}

export function checkComplementConsistency(yesFair: number, noFair: number, toleranceCents: number): boolean {
  const diffCents = Math.abs(yesFair + noFair - 1.0) * 100;
  return diffCents <= toleranceCents;
}
