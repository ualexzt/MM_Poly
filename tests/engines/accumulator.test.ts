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
  it('buys the side with the lower expected pair cost when both opportunities exist', () => {
    const yesBook = makeBook({ asks: [ask(0.80, 20)] });
    const noBook = makeBook({ asks: [ask(0.70, 20)] });

    const decision = decideAccumulatorEntry(emptyPosition(), yesBook, noBook, DEFAULT_CONFIG);

    expect(decision.side).toBe('NO');
    expect(decision.limitPrice).toBe(0.70);
    expect(decision.sizeShares).toBe(2);
    expect(decision.expectedPairCost).toBe(0.70);
  });

  it('uses existing opposite-side average price for opportunity checks', () => {
    const position: Position = { yesQty: 0, noQty: 2, avgYesPrice: 0, avgNoPrice: 0.41 };
    const yesBook = makeBook({ asks: [ask(0.54, 20)] });
    const noBook = makeBook({ asks: [ask(0.99, 20)] });

    const decision = decideAccumulatorEntry(position, yesBook, noBook, DEFAULT_CONFIG);

    expect(decision.side).toBe('YES');
    expect(decision.expectedPairCost).toBeCloseTo(0.95);
    expect(decision.reason).toContain('ask_yes + avg_no');
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

  it('enforces original delta constraint before buying more of an over-weight side', () => {
    const position: Position = { yesQty: 4, noQty: 0, avgYesPrice: 0.50, avgNoPrice: 0 };
    const yesBook = makeBook({ asks: [ask(0.20, 20)] });
    const noBook = makeBook({ asks: [ask(0.99, 20)] });

    const decision = decideAccumulatorEntry(position, yesBook, noBook, DEFAULT_CONFIG);

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
    const yesBook = makeBook({ asks: [ask(0.50, 3)] });
    const noBook = makeBook({ asks: [ask(0.55, 50)] });

    const decision = decideAccumulatorEntry(emptyPosition(), yesBook, noBook, config);

    expect(decision.side).toBe('YES');
    expect(decision.sizeShares).toBe(3);
    expect(decision.sizeUsd).toBeCloseTo(1.5);
  });

  it('upsizes shares to meet CLOB minimum order notional', () => {
    const config = { ...DEFAULT_CONFIG, minOrderNotionalUsd: 1 };
    const yesBook = makeBook({ asks: [ask(0.25, 20)] });
    const noBook = makeBook({ asks: [ask(0.80, 30)] });

    const decision = decideAccumulatorEntry(emptyPosition(), yesBook, noBook, config);

    // tradeSize=2 × 0.25 = 0.50 < 1 → upsize to ceil(1/0.25) = 4 shares
    expect(decision.side).toBe('YES');
    expect(decision.sizeShares).toBe(4);
    expect(decision.sizeUsd).toBe(1);
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
