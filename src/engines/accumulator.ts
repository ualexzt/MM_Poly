import { BookState } from '../types/book';

export interface AccumulatorConfig {
  /** Pair-cost target: avg_YES + avg_NO < targetPairCost (article: < 0.99). */
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
  /** Minimum profit per share to trigger a take-profit SELL (default 0 = any profit). */
  minProfitPerShareUsd?: number;
  /** Skip markets where spread > this value (placeholder-order guard). */
  maxSpread?: number;
}

export interface Position {
  yesQty: number;
  noQty: number;
  avgYesPrice: number;
  avgNoPrice: number;
}

export interface AccumulatorDecision {
  side: 'YES' | 'NO' | 'SELL_YES' | 'SELL_NO' | 'SKIP';
  /** Price at which to execute the limit order. */
  limitPrice: number;
  /** Quantity in outcome shares. */
  sizeShares: number;
  /** Notional value at limitPrice. */
  sizeUsd: number;
  /** For BUY: expected total pair cost. For SELL: realized profit. */
  expectedPairCost: number;
  reason: string;
}

interface Opportunity {
  side: 'YES' | 'NO';
  price: number;
  expectedPairCost: number;
  reason: string;
}

/** Best estimate of "real" price when orderbook has wide spreads. */
function estPrice(book: BookState): number {
  return book.lastTradePrice ?? book.midpoint ?? book.bestAsk ?? 0.50;
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
    side: 'SKIP', limitPrice: 0, sizeShares: 0, sizeUsd: 0, expectedPairCost: 0, reason,
  };
}

function sell(side: 'SELL_YES' | 'SELL_NO', price: number, size: number, avgPaid: number, reason: string): AccumulatorDecision {
  const profitPerShare = price - avgPaid;
  return {
    side, limitPrice: price, sizeShares: size, sizeUsd: size * price,
    expectedPairCost: profitPerShare * size, reason,
  };
}

export function decideAccumulatorEntry(
  position: Position,
  yesBook: BookState,
  noBook: BookState,
  config: AccumulatorConfig,
): AccumulatorDecision {
  // --- Spread filter: skip markets with placeholder orders ---
  const maxSpread = config.maxSpread ?? 1.0;
  if (yesBook.spread !== null && yesBook.spread > maxSpread) {
    return skip(`YES spread ${yesBook.spread.toFixed(3)} > max ${maxSpread}`);
  }
  if (noBook.spread !== null && noBook.spread > maxSpread) {
    return skip(`NO spread ${noBook.spread.toFixed(3)} > max ${maxSpread}`);
  }

  if (!hasUsableAsk(yesBook) || !hasUsableAsk(noBook)) {
    return skip('Incomplete order book, skipping scan');
  }

  const exposure = currentExposureUsd(position);
  if (exposure >= config.maxExposurePerMarketUsd) {
    return skip('exposure limit reached');
  }

  const askYes = yesBook.bestAsk!;
  const askNo = noBook.bestAsk!;
  const bidYes = yesBook.bestBid;
  const bidNo = noBook.bestBid;

  // --- Take-profit exits: sell a side that's in profit ---
  const minProfit = config.minProfitPerShareUsd ?? 0;
  const sellOps: Array<{ side: 'SELL_YES' | 'SELL_NO'; price: number; qty: number; avgPaid: number; profitMargin: number }> = [];

  if (position.yesQty > 0 && bidYes !== null && bidYes > position.avgYesPrice + minProfit) {
    const sellQty = Math.min(position.yesQty, config.tradeSize, yesBook.bids[0]?.size ?? 0);
    if (sellQty > 0) {
      sellOps.push({
        side: 'SELL_YES', price: bidYes, qty: sellQty, avgPaid: position.avgYesPrice,
        profitMargin: bidYes - position.avgYesPrice,
      });
    }
  }

  if (position.noQty > 0 && bidNo !== null && bidNo > position.avgNoPrice + minProfit) {
    const sellQty = Math.min(position.noQty, config.tradeSize, noBook.bids[0]?.size ?? 0);
    if (sellQty > 0) {
      sellOps.push({
        side: 'SELL_NO', price: bidNo, qty: sellQty, avgPaid: position.avgNoPrice,
        profitMargin: bidNo - position.avgNoPrice,
      });
    }
  }

  if (sellOps.length > 0) {
    sellOps.sort((a, b) => b.profitMargin - a.profitMargin);
    const best = sellOps[0];
    const sideName = best.side === 'SELL_YES' ? 'YES' : 'NO';
    const sellNotional = best.qty * best.price;
    const minNotionalSell = config.minOrderNotionalUsd ?? 0;
    if (minNotionalSell > 0 && sellNotional < minNotionalSell) {
      return skip(`take-profit SELL ${sideName} notional ${sellNotional.toFixed(2)} < min ${minNotionalSell}`);
    }
    return sell(
      best.side, best.price, best.qty, best.avgPaid,
      `take-profit: sell ${sideName} @ ${best.price.toFixed(3)} (avg ${best.avgPaid.toFixed(3)}, profit/shr ${best.profitMargin.toFixed(3)})`,
    );
  }

  // --- Pair-cost accumulation (Gabagool strategy from article) ---
  // Article formula: Pair Cost = avg_YES + avg_NO.
  // When a side hasn't been bought (avg=0), use estimated market price
  // to evaluate whether the eventual pair can be profitable.
  const estNo = position.noQty > 0 ? position.avgNoPrice : estPrice(noBook);
  const estYes = position.yesQty > 0 ? position.avgYesPrice : estPrice(yesBook);

  // For the order itself, use estimated price (not placeholder ask)
  // to get a realistic fill. Fall back to ask if estimation is unavailable.
  const buyYesPrice = estPrice(yesBook) > 0 ? estPrice(yesBook) : askYes;
  const buyNoPrice = estPrice(noBook) > 0 ? estPrice(noBook) : askNo;

  const opportunities: Opportunity[] = [];

  const yesExpectedPairCost = buyYesPrice + estNo;
  if (yesExpectedPairCost < config.targetPairCost) {
    opportunities.push({
      side: 'YES',
      price: buyYesPrice,
      expectedPairCost: yesExpectedPairCost,
      reason: `buy YES @ ${buyYesPrice.toFixed(3)} + ${position.noQty > 0 ? 'avg_no' : 'est_no'}(=${estNo.toFixed(3)}) = ${yesExpectedPairCost.toFixed(3)} < target ${config.targetPairCost}`,
    });
  }

  const noExpectedPairCost = buyNoPrice + estYes;
  if (noExpectedPairCost < config.targetPairCost) {
    opportunities.push({
      side: 'NO',
      price: buyNoPrice,
      expectedPairCost: noExpectedPairCost,
      reason: `buy NO @ ${buyNoPrice.toFixed(3)} + ${position.yesQty > 0 ? 'avg_yes' : 'est_yes'}(=${estYes.toFixed(3)}) = ${noExpectedPairCost.toFixed(3)} < target ${config.targetPairCost}`,
    });
  }

  if (opportunities.length === 0) {
    return skip(`no opportunity: est pair costs YES=${yesExpectedPairCost.toFixed(3)} NO=${noExpectedPairCost.toFixed(3)} >= target ${config.targetPairCost}`);
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
