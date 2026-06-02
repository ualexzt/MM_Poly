import { BookState } from '../types/book';

export interface EqualizerConfig {
  imbalanceThreshold: number;
  /** Order quantity in outcome shares. */
  tradeSize: number;
  /** Original equalizer cap: keep resulting pair cost below this (default 0.99). */
  maxPairCost: number;
  /** CLOB minimum order notional in USD. If sizeUsd falls below, sizeShares is upsized. */
  minOrderNotionalUsd?: number;
}

export interface Position {
  yesQty: number;
  noQty: number;
  avgYesPrice: number;
  avgNoPrice: number;
}

export interface EqualizerDecision {
  side: 'YES' | 'NO' | 'BALANCED';
  limitPrice: number;
  sizeShares: number;
  sizeUsd: number;
  reason: string;
}

function balanced(reason: string): EqualizerDecision {
  return {
    side: 'BALANCED',
    limitPrice: 0,
    sizeShares: 0,
    sizeUsd: 0,
    reason,
  };
}

function hasUsableAsk(book: BookState): boolean {
  return book.bestAsk !== null && book.asks.length > 0 && book.asks[0].size > 0;
}

export function decideEqualizer(
  position: Position,
  yesBook: BookState,
  noBook: BookState,
  config: EqualizerConfig,
): EqualizerDecision {
  if (position.yesQty === 0 && position.noQty === 0) {
    return balanced('empty position');
  }

  const delta = position.yesQty - position.noQty;
  if (Math.abs(delta) <= config.imbalanceThreshold) {
    return balanced('within threshold');
  }

  const laggingSide: 'YES' | 'NO' = delta > 0 ? 'NO' : 'YES';
  const targetQty = Math.abs(delta);
  const neededBook = laggingSide === 'YES' ? yesBook : noBook;
  const oppositeAvg = laggingSide === 'YES' ? position.avgNoPrice : position.avgYesPrice;

  if (!hasUsableAsk(neededBook)) {
    return balanced(`${laggingSide} ask unavailable`);
  }

  const maxPrice = config.maxPairCost - oppositeAvg;
  if (maxPrice <= 0) {
    return balanced(`Cannot rebalance: max price ${maxPrice.toFixed(3)} is non-positive`);
  }

  const bestAsk = neededBook.bestAsk!;
  const limitPrice = Math.min(bestAsk, maxPrice);
  let sizeShares = Math.min(targetQty, config.tradeSize, neededBook.asks[0].size);

  // Upsize to meet CLOB minimum order notional
  const minNotional = config.minOrderNotionalUsd ?? 0;
  if (minNotional > 0 && sizeShares * limitPrice < minNotional) {
    const upsizedShares = Math.ceil(minNotional / limitPrice);
    sizeShares = Math.min(upsizedShares, neededBook.asks[0].size, targetQty);
  }

  if (sizeShares <= 0) {
    return balanced('no size available to rebalance');
  }

  const priceReason = bestAsk > maxPrice
    ? `at max price ${maxPrice.toFixed(3)} to preserve pair cost`
    : `at best ask ${bestAsk.toFixed(3)}`;

  return {
    side: laggingSide,
    limitPrice,
    sizeShares,
    sizeUsd: limitPrice * sizeShares,
    reason: `rebalance lagging side ${laggingSide}: delta=${delta.toFixed(3)}, ${priceReason}`,
  };
}
