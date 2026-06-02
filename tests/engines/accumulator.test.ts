import { BookState } from '../../src/types/book';
import {
  decideAccumulatorEntry,
  AccumulatorConfig,
  Position,
} from '../../src/engines/accumulator';

const DEFAULT_CONFIG: AccumulatorConfig = {
  targetPairCost: 0.98,
  tradeSize: 2,
  maxUnhedgedDelta: 4,
  minLiquidityMultiplier: 3,
  maxExposurePerMarketUsd: 5,
};

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

function ask(price: number, size: number) {
  return { price, size, sizeUsd: price * size };
}

function emptyPosition(): Position {
  return { yesQty: 0, noQty: 0, avgYesPrice: 0, avgNoPrice: 0 };
}

describe('decideAccumulatorEntry - original Gabagool accumulator', () => {
  it('buys the cheaper side when pair cost is below target (empty position)', () => {
    const yesBook = makeBook({ asks: [ask(0.42, 20)] });
    const noBook = makeBook({ asks: [ask(0.50, 20)] });

    const decision = decideAccumulatorEntry(emptyPosition(), yesBook, noBook, DEFAULT_CONFIG);

    // ask_yes(0.42) + ask_no(0.50) = 0.92 < 0.98 → YES
    expect(decision.side).toBe('YES');
    expect(decision.limitPrice).toBe(0.42);
    expect(decision.sizeShares).toBe(2);
    expect(decision.expectedPairCost).toBeCloseTo(0.92);
  });

  it('uses existing opposite-side average price when position exists', () => {
    const position: Position = { yesQty: 0, noQty: 2, avgYesPrice: 0, avgNoPrice: 0.41 };
    const yesBook = makeBook({ asks: [ask(0.54, 20)] });
    const noBook = makeBook({ asks: [ask(0.99, 20)] });

    const decision = decideAccumulatorEntry(position, yesBook, noBook, DEFAULT_CONFIG);

    // yesExpectedPairCost = 0.54 + 0.41(avg_no) = 0.95 < 0.98
    expect(decision.side).toBe('YES');
    expect(decision.expectedPairCost).toBeCloseTo(0.95);
    expect(decision.reason).toContain('avg_no');
  });

  it('skips when neither side keeps expected pair cost below target', () => {
    const position: Position = { yesQty: 2, noQty: 2, avgYesPrice: 0.55, avgNoPrice: 0.50 };
    const yesBook = makeBook({ asks: [ask(0.50, 20)] });
    const noBook = makeBook({ asks: [ask(0.48, 20)] });

    const decision = decideAccumulatorEntry(position, yesBook, noBook, DEFAULT_CONFIG);

    expect(decision.side).toBe('SKIP');
    expect(decision.reason).toContain('no opportunity');
  });

  it('skips incomplete or empty ask books instead of treating zero as liquidity', () => {
    const yesBook = makeBook({ asks: [] });
    const noBook = makeBook({ asks: [ask(0.50, 20)] });

    const decision = decideAccumulatorEntry(emptyPosition(), yesBook, noBook, DEFAULT_CONFIG);

    expect(decision.side).toBe('SKIP');
    expect(decision.reason).toContain('Incomplete order book');
  });

  it('enforces delta when pair cost is below target but existing position is overweight', () => {
    const position: Position = { yesQty: 4, noQty: 0, avgYesPrice: 0.50, avgNoPrice: 0 };
    const yesBook = makeBook({ asks: [ask(0.20, 20)] });
    const noBook = makeBook({ asks: [ask(0.70, 20)] });

    const decision = decideAccumulatorEntry(position, yesBook, noBook, DEFAULT_CONFIG);

    // ask_yes(0.20) + ask_no(0.70) = 0.90 < 0.98 → YES opportunity
    // but delta: 4 existing + 2 new = 6 > max 4 → SKIP
    expect(decision.side).toBe('SKIP');
    expect(decision.reason).toContain('Delta constraint');
  });

  it('requires opposite ask depth at least tradeSize times liquidity multiplier', () => {
    const yesBook = makeBook({ asks: [ask(0.40, 20)] });
    const noBook = makeBook({ asks: [ask(0.50, 2), ask(0.51, 1)] }); // 3 shares < 2 * 3

    const decision = decideAccumulatorEntry(emptyPosition(), yesBook, noBook, DEFAULT_CONFIG);

    expect(decision.side).toBe('SKIP');
    expect(decision.reason).toContain('Liquidity constraint');
  });

  it('caps trade size by remaining per-market exposure and available ask size', () => {
    const config = { ...DEFAULT_CONFIG, tradeSize: 10, maxExposurePerMarketUsd: 5 };
    const yesBook = makeBook({ asks: [ask(0.40, 3)] });
    const noBook = makeBook({ asks: [ask(0.45, 50)] });

    const decision = decideAccumulatorEntry(emptyPosition(), yesBook, noBook, config);

    // ask_yes(0.40) + ask_no(0.45) = 0.85 < 0.98 → YES, capped at ask size 3
    expect(decision.side).toBe('YES');
    expect(decision.sizeShares).toBe(3);
    expect(decision.sizeUsd).toBeCloseTo(1.2);
  });

  it('upsizes shares to meet CLOB minimum order notional', () => {
    const config = { ...DEFAULT_CONFIG, minOrderNotionalUsd: 1 };
    const yesBook = makeBook({ asks: [ask(0.30, 20)] });
    const noBook = makeBook({ asks: [ask(0.50, 30)] });

    const decision = decideAccumulatorEntry(emptyPosition(), yesBook, noBook, config);

    // ask_yes(0.30) + ask_no(0.50) = 0.80, tradeSize=2 × 0.30 = 0.60 < 1
    // upsize to ceil(1/0.30) = 4 shares
    expect(decision.side).toBe('YES');
    expect(decision.sizeShares).toBe(4);
    expect(decision.sizeUsd).toBeCloseTo(1.20);
  });

  it('skips when upsized shares capped by delta leave notional below minimum', () => {
    const config = { ...DEFAULT_CONFIG, minOrderNotionalUsd: 1 };
    const yesBook = makeBook({ asks: [ask(0.13, 20)] });
    const noBook = makeBook({ asks: [ask(0.80, 30)] });

    const decision = decideAccumulatorEntry(emptyPosition(), yesBook, noBook, config);

    // upsize to ceil(1/0.13) = 8, delta capped at 4 → 4 × 0.13 = 0.52 < 1 → SKIP
    expect(decision.side).toBe('SKIP');
    expect(decision.reason).toContain('min notional unreachable');
  });
});

describe('decideAccumulatorEntry - take-profit exits', () => {
  it('sells YES when held at a profit', () => {
    const position: Position = { yesQty: 5, noQty: 0, avgYesPrice: 0.30, avgNoPrice: 0 };
    const yesBook = makeBook({ asks: [ask(0.50, 20)], bids: [{ price: 0.48, size: 10, sizeUsd: 4.8 }], bestBid: 0.48 });
    const noBook = makeBook({ asks: [ask(0.55, 20)] });

    const decision = decideAccumulatorEntry(position, yesBook, noBook, DEFAULT_CONFIG);

    expect(decision.side).toBe('SELL_YES');
    expect(decision.limitPrice).toBe(0.48);
    expect(decision.sizeShares).toBe(2); // capped by tradeSize
    expect(decision.reason).toContain('take-profit');
    expect(decision.reason).toContain('0.480');
  });

  it('sells NO when held at a profit', () => {
    const position: Position = { yesQty: 0, noQty: 5, avgYesPrice: 0, avgNoPrice: 0.25 };
    const yesBook = makeBook({ asks: [ask(0.50, 20)] });
    const noBook = makeBook({ asks: [ask(0.55, 20)], bids: [{ price: 0.40, size: 10, sizeUsd: 4.0 }], bestBid: 0.40 });

    const decision = decideAccumulatorEntry(position, yesBook, noBook, DEFAULT_CONFIG);

    expect(decision.side).toBe('SELL_NO');
    expect(decision.limitPrice).toBe(0.40);
    expect(decision.reason).toContain('take-profit');
  });

  it('prefers higher profit margin when both sides are profitable', () => {
    const position: Position = { yesQty: 5, noQty: 5, avgYesPrice: 0.30, avgNoPrice: 0.40 };
    const yesBook = makeBook({ asks: [ask(0.50, 20)], bids: [{ price: 0.48, size: 10, sizeUsd: 4.8 }], bestBid: 0.48 });
    const noBook = makeBook({ asks: [ask(0.55, 20)], bids: [{ price: 0.44, size: 10, sizeUsd: 4.4 }], bestBid: 0.44 });

    const decision = decideAccumulatorEntry(position, yesBook, noBook, DEFAULT_CONFIG);

    // YES margin: 0.48-0.30=0.18, NO margin: 0.44-0.40=0.04 → pick SELL_YES
    expect(decision.side).toBe('SELL_YES');
    expect(decision.expectedPairCost).toBeCloseTo(0.36); // 2 shares × 0.18 profit/shr
  });

  it('skips take-profit when profit below minProfitPerShareUsd and pair cost too high', () => {
    const config = { ...DEFAULT_CONFIG, minProfitPerShareUsd: 0.05 };
    const position: Position = { yesQty: 5, noQty: 0, avgYesPrice: 0.30, avgNoPrice: 0 };
    const yesBook = makeBook({ asks: [ask(0.50, 20)], bids: [{ price: 0.33, size: 10, sizeUsd: 3.3 }], bestBid: 0.33 });
    const noBook = makeBook({ asks: [ask(0.75, 20)] });

    const decision = decideAccumulatorEntry(position, yesBook, noBook, config);

    // margin 0.03 < 0.05 → no take-profit
    // noExpectedPairCost = 0.75 + 0.30 = 1.05 > 0.98 → no BUY either → SKIP
    expect(decision.side).toBe('SKIP');
  });
});
