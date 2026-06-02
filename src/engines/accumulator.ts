import { BookState } from '../types/book';

export interface AccumulatorConfig {
  /** Original Gabagool target: 1.00 - profit_margin (default 0.98). */
  targetPairCost: number;
  /** Order quantity in outcome shares, not USD. */
  tradeSize: number;
  /** Maximum absolute delta: yesQty - noQty. */
  maxUnhedgedDelta: number;
  /** Opposite side ASK depth must be at least tradeSize * multiplier. */
  minLiquidityMultiplier: number;
  maxExposurePerMarketUsd: number;
  /** CLOB minimum order notional in USD. If sizeUsd falls below, sizeShares is upsized. */
  minOrderNotionalUsd?: number;
}

export interface Position {
  yesQty: number;
  noQty: number;
  avgYesPrice: number;
  avgNoPrice: number;
}

export interface AccumulatorDecision {
  side: 'YES' | 'NO' | 'SKIP';
  limitPrice: number;
  /** Quantity in outcome shares. */
  sizeShares: number;
  /** Notional cost at limitPrice. */
  sizeUsd: number;
  expectedPairCost: number;
  reason: string;
}

interface Opportunity {
  side: 'YES' | 'NO';
  price: number;
  expectedPairCost: number;
  reason: string;
}

function currentExposureUsd(pos: Position): number {
  return pos.yesQty * pos.avgYesPrice + pos.noQty * pos.avgNoPrice;
}

function currentDelta(pos: Position): number {
  return pos.yesQty - pos.noQty;
}

function askDepthShares(book: BookState, maxLevels = 5): number {
  return book.asks.slice(0, maxLevels).reduce((sum, level) => sum + level.size, 0);
}

function hasUsableAsk(book: BookState): boolean {
  return book.bestAsk !== null && book.asks.length > 0 && book.asks[0].size > 0;
}

function skip(reason: string): AccumulatorDecision {
  return {
    side: 'SKIP',
    limitPrice: 0,
    sizeShares: 0,
    sizeUsd: 0,
    expectedPairCost: 0,
    reason,
  };
}

export function decideAccumulatorEntry(
  position: Position,
  yesBook: BookState,
  noBook: BookState,
  config: AccumulatorConfig,
): AccumulatorDecision {
  if (!hasUsableAsk(yesBook) || !hasUsableAsk(noBook)) {
    return skip('Incomplete order book, skipping scan');
  }

  const exposure = currentExposureUsd(position);
  if (exposure >= config.maxExposurePerMarketUsd) {
    return skip('exposure limit reached');
  }

  const askYes = yesBook.bestAsk!;
  const askNo = noBook.bestAsk!;

  const opportunities: Opportunity[] = [];

  const yesExpectedPairCost = askYes + position.avgNoPrice;
  if (yesExpectedPairCost < config.targetPairCost) {
    opportunities.push({
      side: 'YES',
      price: askYes,
      expectedPairCost: yesExpectedPairCost,
      reason: `ask_yes + avg_no = ${yesExpectedPairCost.toFixed(3)} < target ${config.targetPairCost}`,
    });
  }

  const noExpectedPairCost = askNo + position.avgYesPrice;
  if (noExpectedPairCost < config.targetPairCost) {
    opportunities.push({
      side: 'NO',
      price: askNo,
      expectedPairCost: noExpectedPairCost,
      reason: `ask_no + avg_yes = ${noExpectedPairCost.toFixed(3)} < target ${config.targetPairCost}`,
    });
  }

  if (opportunities.length === 0) {
    return skip('no opportunity below target pair cost');
  }

  opportunities.sort((a, b) => a.expectedPairCost - b.expectedPairCost);
  const best = opportunities[0];
  const ownBook = best.side === 'YES' ? yesBook : noBook;
  const oppositeBook = best.side === 'YES' ? noBook : yesBook;

  const maxAddUsd = config.maxExposurePerMarketUsd - exposure;
  const maxByExposureShares = maxAddUsd / best.price;
  let sizeShares = Math.min(config.tradeSize, ownBook.asks[0].size, maxByExposureShares);

  // Upsize to meet CLOB minimum order notional, capped by delta
  const minNotional = config.minOrderNotionalUsd ?? 0;
  if (minNotional > 0 && sizeShares * best.price < minNotional) {
    const upsizedShares = Math.ceil(minNotional / best.price);
    const maxByDelta = config.maxUnhedgedDelta - Math.abs(currentDelta(position));
    sizeShares = Math.min(upsizedShares, ownBook.asks[0].size, maxByExposureShares, maxByDelta);
    // If delta-capped size still doesn't meet min notional, we can't trade at this price
    if (sizeShares * best.price < minNotional) {
      return skip(`min notional unreachable at price ${best.price.toFixed(3)}: need ${upsizedShares} shares (delta cap ${maxByDelta.toFixed(1)})`);
    }
  }

  if (sizeShares <= 0) {
    return skip('no remaining exposure or ask size');
  }

  const newDelta = currentDelta(position) + (best.side === 'YES' ? sizeShares : -sizeShares);
  if (Math.abs(newDelta) > config.maxUnhedgedDelta) {
    return skip(`Delta constraint violated: new_delta=${newDelta.toFixed(3)}, max=${config.maxUnhedgedDelta}`);
  }

  const requiredOppositeLiquidity = sizeShares * config.minLiquidityMultiplier;
  const availableOppositeLiquidity = askDepthShares(oppositeBook, 5);
  if (availableOppositeLiquidity < requiredOppositeLiquidity) {
    return skip(`Liquidity constraint violated: available=${availableOppositeLiquidity.toFixed(3)}, required=${requiredOppositeLiquidity.toFixed(3)}`);
  }

  return {
    side: best.side,
    limitPrice: best.price,
    sizeShares,
    sizeUsd: sizeShares * best.price,
    expectedPairCost: best.expectedPairCost,
    reason: best.reason,
  };
}
