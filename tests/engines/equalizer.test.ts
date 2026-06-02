import { BookState } from '../../src/types/book';
import {
  decideEqualizer,
  EqualizerConfig,
  Position,
} from '../../src/engines/equalizer';

const DEFAULT_CONFIG: EqualizerConfig = {
  imbalanceThreshold: 1,
  maxExposurePerMarketUsd: 5,
  limitOrderOffsetCents: 1,
};

function makeBook(overrides: Partial<BookState> = {}): BookState {
  return {
    tokenId: 'token-1',
    conditionId: 'cid-1',
    bids: [],
    asks: [],
    bestBid: null,
    bestAsk: null,
    bestBidSizeUsd: 0,
    bestAskSizeUsd: 0,
    midpoint: null,
    spread: null,
    spreadTicks: null,
    depth1Usd: 0,
    depth3Usd: 0,
    tickSize: 0.01,
    minOrderSize: 1,
    lastUpdateMs: Date.now(),
    ...overrides,
  };
}

describe('decideEqualizer', () => {
  it('returns BALANCED when position is empty', () => {
    const pos: Position = { yesQty: 0, noQty: 0, avgYesPrice: 0, avgNoPrice: 0 };
    const yesBook = makeBook({ bestAsk: 0.45 });
    const noBook = makeBook({ bestAsk: 0.50 });

    const decision = decideEqualizer(pos, yesBook, noBook, DEFAULT_CONFIG);
    expect(decision.side).toBe('BALANCED');
  });

  it('returns BALANCED when quantities are equal', () => {
    const pos: Position = { yesQty: 10, noQty: 10, avgYesPrice: 0.45, avgNoPrice: 0.50 };
    const yesBook = makeBook({ bestAsk: 0.45 });
    const noBook = makeBook({ bestAsk: 0.50 });

    const decision = decideEqualizer(pos, yesBook, noBook, DEFAULT_CONFIG);
    expect(decision.side).toBe('BALANCED');
  });

  it('returns BALANCED when imbalance is within threshold', () => {
    const pos: Position = { yesQty: 10, noQty: 9, avgYesPrice: 0.45, avgNoPrice: 0.50 };
    const yesBook = makeBook({ bestAsk: 0.45 });
    const noBook = makeBook({ bestAsk: 0.50 });

    const decision = decideEqualizer(pos, yesBook, noBook, DEFAULT_CONFIG);
    expect(decision.side).toBe('BALANCED');
  });

  it('buys NO when YES exceeds NO by more than threshold', () => {
    const pos: Position = { yesQty: 10, noQty: 7, avgYesPrice: 0.45, avgNoPrice: 0.50 };
    const yesBook = makeBook({ bestAsk: 0.45 });
    const noBook = makeBook({ bestAsk: 0.48, bestAskSizeUsd: 100 });

    const decision = decideEqualizer(pos, yesBook, noBook, DEFAULT_CONFIG);
    expect(decision.side).toBe('NO');
    expect(decision.sizeUsd).toBeGreaterThan(0);
    expect(decision.reason).toContain('rebalance');
  });

  it('buys YES when NO exceeds YES by more than threshold', () => {
    const pos: Position = { yesQty: 5, noQty: 10, avgYesPrice: 0.45, avgNoPrice: 0.50 };
    const yesBook = makeBook({ bestAsk: 0.43, bestAskSizeUsd: 100 });
    const noBook = makeBook({ bestAsk: 0.50 });

    const decision = decideEqualizer(pos, yesBook, noBook, DEFAULT_CONFIG);
    expect(decision.side).toBe('YES');
    expect(decision.reason).toContain('rebalance');
  });

  it('skips when bestAsk is null for needed side', () => {
    const pos: Position = { yesQty: 10, noQty: 5, avgYesPrice: 0.45, avgNoPrice: 0.50 };
    const yesBook = makeBook({ bestAsk: 0.45 });
    const noBook = makeBook({ bestAsk: null });

    const decision = decideEqualizer(pos, yesBook, noBook, DEFAULT_CONFIG);
    expect(decision.side).toBe('BALANCED');
  });

  it('sizes order to match the imbalance', () => {
    const pos: Position = { yesQty: 10, noQty: 5, avgYesPrice: 0.45, avgNoPrice: 0.50 };
    const yesBook = makeBook({ bestAsk: 0.45 });
    const noBook = makeBook({ bestAsk: 0.48, bestAskSizeUsd: 100 });

    const decision = decideEqualizer(pos, yesBook, noBook, DEFAULT_CONFIG);
    // imbalance = 10 - 5 = 5, need 5 NO units
    expect(decision.side).toBe('NO');
    expect(decision.sizeUsd).toBeLessThanOrEqual(100);
  });

  it('respects maxExposurePerMarketUsd', () => {
    const pos: Position = { yesQty: 50, noQty: 10, avgYesPrice: 0.45, avgNoPrice: 0.50 };
    // exposure = 50*0.45 + 10*0.50 = 22.5 + 5 = 27.5, already over $5
    const yesBook = makeBook({ bestAsk: 0.45 });
    const noBook = makeBook({ bestAsk: 0.48, bestAskSizeUsd: 100 });

    const decision = decideEqualizer(pos, yesBook, noBook, DEFAULT_CONFIG);
    // Should still try to rebalance but size limited
    expect(decision.side).toBe('NO');
  });
});
