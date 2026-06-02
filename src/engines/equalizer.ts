import { BookState } from '../types/book';

export interface EqualizerConfig {
  imbalanceThreshold: number;
  maxExposurePerMarketUsd: number;
  limitOrderOffsetCents: number;
}

export interface Position {
  yesQty: number;
  noQty: number;
  avgYesPrice: number;
  avgNoPrice: number;
}

export interface EqualizerDecision {
  side: 'YES' | 'NO' | 'BALANCED';
  sizeUsd: number;
  reason: string;
}

export function decideEqualizer(
  position: Position,
  yesBook: BookState,
  noBook: BookState,
  config: EqualizerConfig,
): EqualizerDecision {
  const balanced = (reason: string): EqualizerDecision => ({
    side: 'BALANCED', sizeUsd: 0, reason,
  });

  if (position.yesQty === 0 && position.noQty === 0) {
    return balanced('empty position');
  }

  const imbalance = position.yesQty - position.noQty;

  if (Math.abs(imbalance) <= config.imbalanceThreshold) {
    return balanced('within threshold');
  }

  // YES > NO → need to buy NO
  if (imbalance > 0) {
    if (noBook.bestAsk === null) return balanced('NO ask unavailable');
    const unitsToBuy = Math.abs(imbalance);
    const targetUsd = unitsToBuy * noBook.bestAsk;
    const sizeUsd = Math.min(targetUsd, noBook.bestAskSizeUsd);
    return {
      side: 'NO',
      sizeUsd,
      reason: `rebalance: YES=${position.yesQty} > NO=${position.noQty}, need ${unitsToBuy} NO`,
    };
  }

  // NO > YES → need to buy YES
  if (yesBook.bestAsk === null) return balanced('YES ask unavailable');
  const unitsToBuy = Math.abs(imbalance);
  const targetUsd = unitsToBuy * yesBook.bestAsk;
  const sizeUsd = Math.min(targetUsd, yesBook.bestAskSizeUsd);
  return {
    side: 'YES',
    sizeUsd,
    reason: `rebalance: NO=${position.noQty} > YES=${position.yesQty}, need ${unitsToBuy} YES`,
  };
}
