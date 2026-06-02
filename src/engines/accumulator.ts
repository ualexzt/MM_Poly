import { BookState } from '../types/book';

export interface AccumulatorConfig {
  maxPairCost: number;
  minEdgeBps: number;
  maxExposurePerMarketUsd: number;
  limitOrderOffsetCents: number;
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
  sizeUsd: number;
  reason: string;
}

function currentExposureUsd(pos: Position): number {
  return pos.yesQty * pos.avgYesPrice + pos.noQty * pos.avgNoPrice;
}

export function decideAccumulatorEntry(
  position: Position,
  yesBook: BookState,
  noBook: BookState,
  config: AccumulatorConfig,
): AccumulatorDecision {
  const skip = (reason: string): AccumulatorDecision => ({
    side: 'SKIP', limitPrice: 0, sizeUsd: 0, reason,
  });

  if (yesBook.bestAsk === null || noBook.bestAsk === null) {
    return skip('missing ask price');
  }

  const exposure = currentExposureUsd(position);
  if (exposure >= config.maxExposurePerMarketUsd) {
    return skip('exposure limit reached');
  }

  const maxAddUsd = config.maxExposurePerMarketUsd - exposure;
  const hasYes = position.yesQty > 0;
  const hasNo = position.noQty > 0;

  // Case 1: Empty position → buy cheaper side
  if (!hasYes && !hasNo) {
    const rawPairCost = yesBook.bestAsk + noBook.bestAsk;
    if (rawPairCost >= config.maxPairCost) {
      return skip(`pair cost ${rawPairCost.toFixed(3)} >= max ${config.maxPairCost}`);
    }

    const buyYes = yesBook.bestAsk <= noBook.bestAsk;
    const side = buyYes ? 'YES' : 'NO';
    const book = buyYes ? yesBook : noBook;
    const limitPrice = Math.max(0.01, book.bestAsk! - config.limitOrderOffsetCents / 100);
    const sizeUsd = Math.min(maxAddUsd, book.bestAskSizeUsd);

    return { side, limitPrice, sizeUsd, reason: `${side} is cheaper (ask=${book.bestAsk!.toFixed(2)})` };
  }

  // Case 2: Has one side → try to complete pair
  if (hasYes && !hasNo) {
    const wouldBePairCost = position.avgYesPrice + noBook.bestAsk;
    if (wouldBePairCost >= config.maxPairCost) {
      return skip(`completing pair would cost ${wouldBePairCost.toFixed(3)} >= max ${config.maxPairCost}`);
    }
    const limitPrice = Math.max(0.01, noBook.bestAsk - config.limitOrderOffsetCents / 100);
    const sizeUsd = Math.min(maxAddUsd, noBook.bestAskSizeUsd, position.yesQty * noBook.bestAsk);
    return { side: 'NO', limitPrice, sizeUsd, reason: 'complete pair (have YES, need NO)' };
  }

  if (!hasYes && hasNo) {
    const wouldBePairCost = yesBook.bestAsk + position.avgNoPrice;
    if (wouldBePairCost >= config.maxPairCost) {
      return skip(`completing pair would cost ${wouldBePairCost.toFixed(3)} >= max ${config.maxPairCost}`);
    }
    const limitPrice = Math.max(0.01, yesBook.bestAsk - config.limitOrderOffsetCents / 100);
    const sizeUsd = Math.min(maxAddUsd, yesBook.bestAskSizeUsd, position.noQty * yesBook.bestAsk);
    return { side: 'YES', limitPrice, sizeUsd, reason: 'complete pair (have NO, need YES)' };
  }

  // Case 3: Has both sides → already paired, skip
  return skip('already have both sides');
}
