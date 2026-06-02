import { BookLevel, BookState } from '../types/book';
import { PairCostSide } from './pair-cost-types';

export interface ExecutablePriceResult {
  requestedQty: number;
  executableQty: number;
  avgPrice: number;
  totalCost: number;
  worstPrice: number;
  enoughDepth: boolean;
  levelsUsed: BookLevel[];
}

const ROUND_FACTOR = 1_000_000_000;

function round(value: number): number {
  return Math.round(value * ROUND_FACTOR) / ROUND_FACTOR;
}

export function getExecutableBuyPrice(
  orderbook: BookState,
  _side: PairCostSide,
  qty: number,
): ExecutablePriceResult {
  const requestedQty = Math.max(0, qty);
  const sortedAsks = [...orderbook.asks].sort((a, b) => a.price - b.price);
  const levelsUsed: BookLevel[] = [];
  let remainingQty = requestedQty;
  let executableQty = 0;
  let totalCost = 0;
  let worstPrice = 0;

  for (const level of sortedAsks) {
    if (remainingQty <= 0) break;
    if (level.size <= 0) continue;

    const levelQty = Math.min(level.size, remainingQty);
    const levelCost = levelQty * level.price;
    levelsUsed.push({
      price: level.price,
      size: round(levelQty),
      sizeUsd: round(levelCost),
    });
    executableQty += levelQty;
    totalCost += levelCost;
    worstPrice = level.price;
    remainingQty -= levelQty;
  }

  const roundedExecutableQty = round(executableQty);
  const roundedTotalCost = round(totalCost);

  return {
    requestedQty,
    executableQty: roundedExecutableQty,
    avgPrice: roundedExecutableQty > 0 ? round(roundedTotalCost / roundedExecutableQty) : 0,
    totalCost: roundedTotalCost,
    worstPrice,
    enoughDepth: roundedExecutableQty >= requestedQty,
    levelsUsed,
  };
}
