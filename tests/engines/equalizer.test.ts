import { BookState } from '../../src/types/book';
import {
  decideEqualizer,
  EqualizerConfig,
  Position,
} from '../../src/engines/equalizer';

const DEFAULT_CONFIG: EqualizerConfig = {
  imbalanceThreshold: 1,
  tradeSize: 2,
  maxPairCost: 0.99,
};

function ask(price: number, size: number) {
  return { price, size, sizeUsd: price * size };
}

function makeBook(overrides: Partial<BookState> = {}): BookState {
  const asks = overrides.asks ?? [];
  const bestAsk = overrides.bestAsk ?? (asks.length > 0 ? asks[0].price : null);
  const bestAskSizeUsd = overrides.bestAskSizeUsd ?? (asks.length > 0 ? asks[0].sizeUsd : 0);

  return {
    tokenId: 'token-1',
    conditionId: 'cid-1',
    bids: [],
    asks,
    bestBid: null,
    bestAsk,
    bestBidSizeUsd: 0,
    bestAskSizeUsd,
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

describe('decideEqualizer - original Gabagool equalizer', () => {
  it('returns BALANCED when position is empty or within threshold', () => {
    const yesBook = makeBook({ asks: [ask(0.45, 20)] });
    const noBook = makeBook({ asks: [ask(0.50, 20)] });

    expect(decideEqualizer({ yesQty: 0, noQty: 0, avgYesPrice: 0, avgNoPrice: 0 }, yesBook, noBook, DEFAULT_CONFIG).side).toBe('BALANCED');
    expect(decideEqualizer({ yesQty: 10, noQty: 9, avgYesPrice: 0.45, avgNoPrice: 0.50 }, yesBook, noBook, DEFAULT_CONFIG).side).toBe('BALANCED');
  });

  it('buys lagging NO when YES quantity is larger', () => {
    const pos: Position = { yesQty: 5, noQty: 1, avgYesPrice: 0.13, avgNoPrice: 0.50 };
    const yesBook = makeBook({ asks: [ask(0.20, 20)] });
    const noBook = makeBook({ asks: [ask(0.70, 20)] });

    const decision = decideEqualizer(pos, yesBook, noBook, DEFAULT_CONFIG);

    expect(decision.side).toBe('NO');
    expect(decision.limitPrice).toBe(0.70);
    expect(decision.sizeShares).toBe(2);
    expect(decision.sizeUsd).toBeCloseTo(1.4);
    expect(decision.reason).toContain('lagging side');
  });

  it('buys lagging YES when NO quantity is larger', () => {
    const pos: Position = { yesQty: 1, noQty: 5, avgYesPrice: 0.50, avgNoPrice: 0.21 };
    const yesBook = makeBook({ asks: [ask(0.60, 20)] });
    const noBook = makeBook({ asks: [ask(0.20, 20)] });

    const decision = decideEqualizer(pos, yesBook, noBook, DEFAULT_CONFIG);

    expect(decision.side).toBe('YES');
    expect(decision.limitPrice).toBe(0.60);
    expect(decision.sizeShares).toBe(2);
  });

  it('bids at max affordable price when best ask would break pair cost', () => {
    const pos: Position = { yesQty: 5, noQty: 1, avgYesPrice: 0.40, avgNoPrice: 0.50 };
    const yesBook = makeBook({ asks: [ask(0.40, 20)] });
    const noBook = makeBook({ asks: [ask(0.75, 20)] });

    const decision = decideEqualizer(pos, yesBook, noBook, DEFAULT_CONFIG);

    expect(decision.side).toBe('NO');
    expect(decision.limitPrice).toBeCloseTo(0.59); // 0.99 - avg YES 0.40
    expect(decision.reason).toContain('max price');
  });

  it('skips when max affordable price is non-positive', () => {
    const pos: Position = { yesQty: 5, noQty: 1, avgYesPrice: 1.00, avgNoPrice: 0.50 };
    const yesBook = makeBook({ asks: [ask(0.40, 20)] });
    const noBook = makeBook({ asks: [ask(0.75, 20)] });

    const decision = decideEqualizer(pos, yesBook, noBook, DEFAULT_CONFIG);

    expect(decision.side).toBe('BALANCED');
    expect(decision.reason).toContain('non-positive');
  });

  it('sizes to min of imbalance, trade size, and available ask size', () => {
    const pos: Position = { yesQty: 5, noQty: 1, avgYesPrice: 0.13, avgNoPrice: 0.50 };
    const yesBook = makeBook({ asks: [ask(0.20, 20)] });
    const noBook = makeBook({ asks: [ask(0.70, 1.5)] });

    const decision = decideEqualizer(pos, yesBook, noBook, DEFAULT_CONFIG);

    expect(decision.side).toBe('NO');
    expect(decision.sizeShares).toBe(1.5);
  });

  it('skips when needed side has no ask', () => {
    const pos: Position = { yesQty: 5, noQty: 1, avgYesPrice: 0.13, avgNoPrice: 0.50 };
    const yesBook = makeBook({ asks: [ask(0.20, 20)] });
    const noBook = makeBook({ asks: [] });

    const decision = decideEqualizer(pos, yesBook, noBook, DEFAULT_CONFIG);

    expect(decision.side).toBe('BALANCED');
    expect(decision.reason).toContain('ask unavailable');
  });

  it('upsizes rebalance shares to meet CLOB minimum order notional', () => {
    const config = { ...DEFAULT_CONFIG, minOrderNotionalUsd: 1 };
    const pos: Position = { yesQty: 5, noQty: 1, avgYesPrice: 0.13, avgNoPrice: 0.50 };
    const yesBook = makeBook({ asks: [ask(0.20, 20)] });
    const noBook = makeBook({ asks: [ask(0.25, 20)] }); // cheap ask

    const decision = decideEqualizer(pos, yesBook, noBook, config);

    // side is NO (lagging), tradeSize=2, 2 × 0.25 = 0.50 < 1 → upsize to ceil(1/0.25) = 4
    expect(decision.side).toBe('NO');
    expect(decision.sizeShares).toBe(4);
    expect(decision.sizeUsd).toBe(1);
  });
});
