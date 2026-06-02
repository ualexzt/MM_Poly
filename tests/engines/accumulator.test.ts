import { BookState } from '../../src/types/book';
import {
  decideAccumulatorEntry,
  AccumulatorConfig,
  Position,
} from '../../src/engines/accumulator';

const DEFAULT_CONFIG: AccumulatorConfig = {
  maxPairCost: 1.03,
  minEdgeBps: 100,
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

function emptyPosition(): Position {
  return { yesQty: 0, noQty: 0, avgYesPrice: 0, avgNoPrice: 0 };
}

describe('decideAccumulatorEntry', () => {
  describe('empty position', () => {
    it('buys YES when it is cheaper', () => {
      const yesBook = makeBook({ bestAsk: 0.42, bestAskSizeUsd: 100 });
      const noBook = makeBook({ bestAsk: 0.52, bestAskSizeUsd: 100 });
      const decision = decideAccumulatorEntry(emptyPosition(), yesBook, noBook, DEFAULT_CONFIG);

      expect(decision.side).toBe('YES');
      expect(decision.limitPrice).toBeCloseTo(0.41); // ask - offset
      expect(decision.sizeUsd).toBeGreaterThan(0);
      expect(decision.reason).toContain('cheaper');
    });

    it('buys NO when it is cheaper', () => {
      const yesBook = makeBook({ bestAsk: 0.55, bestAskSizeUsd: 100 });
      const noBook = makeBook({ bestAsk: 0.40, bestAskSizeUsd: 100 });
      const decision = decideAccumulatorEntry(emptyPosition(), yesBook, noBook, DEFAULT_CONFIG);

      expect(decision.side).toBe('NO');
      expect(decision.limitPrice).toBeCloseTo(0.39);
    });

    it('skips when both sides are too expensive', () => {
      const yesBook = makeBook({ bestAsk: 0.60, bestAskSizeUsd: 100 });
      const noBook = makeBook({ bestAsk: 0.50, bestAskSizeUsd: 100 });
      // pair cost = (0.60+0.50) = 1.10 > maxPairCost 1.03
      const decision = decideAccumulatorEntry(emptyPosition(), yesBook, noBook, DEFAULT_CONFIG);

      expect(decision.side).toBe('SKIP');
    });

    it('skips when either bestAsk is null', () => {
      const yesBook = makeBook({ bestAsk: null });
      const noBook = makeBook({ bestAsk: 0.45 });
      const decision = decideAccumulatorEntry(emptyPosition(), yesBook, noBook, DEFAULT_CONFIG);

      expect(decision.side).toBe('SKIP');
    });
  });

  describe('has one side, needs the other', () => {
    it('buys NO when already has YES and NO is cheap enough', () => {
      const position: Position = { yesQty: 10, noQty: 0, avgYesPrice: 0.42, avgNoPrice: 0 };
      const yesBook = makeBook({ bestAsk: 0.50 });
      const noBook = makeBook({ bestAsk: 0.50, bestAskSizeUsd: 100 });
      // avgPairCost would be 0.42 + 0.50 = 0.92 < 1.03 → buy NO
      const decision = decideAccumulatorEntry(position, yesBook, noBook, DEFAULT_CONFIG);

      expect(decision.side).toBe('NO');
      expect(decision.reason).toContain('complete pair');
    });

    it('buys YES when already has NO and YES is cheap enough', () => {
      const position: Position = { yesQty: 0, noQty: 10, avgYesPrice: 0, avgNoPrice: 0.45 };
      const yesBook = makeBook({ bestAsk: 0.48, bestAskSizeUsd: 100 });
      const noBook = makeBook({ bestAsk: 0.55 });
      // avgPairCost would be 0.48 + 0.45 = 0.93 < 1.03 → buy YES
      const decision = decideAccumulatorEntry(position, yesBook, noBook, DEFAULT_CONFIG);

      expect(decision.side).toBe('YES');
    });

    it('skips when other side is too expensive to complete pair', () => {
      const position: Position = { yesQty: 10, noQty: 0, avgYesPrice: 0.42, avgNoPrice: 0 };
      const yesBook = makeBook({ bestAsk: 0.55 });
      const noBook = makeBook({ bestAsk: 0.65, bestAskSizeUsd: 100 });
      // avgPairCost would be 0.42 + 0.65 = 1.07 > 1.03 → skip
      const decision = decideAccumulatorEntry(position, yesBook, noBook, DEFAULT_CONFIG);

      expect(decision.side).toBe('SKIP');
    });
  });

  describe('has both sides', () => {
    it('skips when pair cost already good enough', () => {
      const position: Position = { yesQty: 10, noQty: 10, avgYesPrice: 0.42, avgNoPrice: 0.45 };
      // avgPairCost = 0.87, already great
      const yesBook = makeBook({ bestAsk: 0.50 });
      const noBook = makeBook({ bestAsk: 0.50 });
      const decision = decideAccumulatorEntry(position, yesBook, noBook, DEFAULT_CONFIG);

      expect(decision.side).toBe('SKIP');
    });
  });

  describe('exposure limit', () => {
    it('skips when adding would exceed per-market limit', () => {
      const position: Position = { yesQty: 50, noQty: 50, avgYesPrice: 0.42, avgNoPrice: 0.45 };
      const yesBook = makeBook({ bestAsk: 0.30, bestAskSizeUsd: 100 });
      const noBook = makeBook({ bestAsk: 0.30, bestAskSizeUsd: 100 });
      // exposure already ~$43.5, well over $5 limit
      const decision = decideAccumulatorEntry(position, yesBook, noBook, DEFAULT_CONFIG);

      expect(decision.side).toBe('SKIP');
      expect(decision.reason).toContain('exposure');
    });
  });

  describe('size calculation', () => {
    it('sizes order based on available liquidity', () => {
      const yesBook = makeBook({ bestAsk: 0.45, bestAskSizeUsd: 3 });
      const noBook = makeBook({ bestAsk: 0.50, bestAskSizeUsd: 100 });
      const decision = decideAccumulatorEntry(emptyPosition(), yesBook, noBook, DEFAULT_CONFIG);

      expect(decision.side).toBe('YES');
      // size should be limited by available liquidity ($3) and max exposure ($5)
      expect(decision.sizeUsd).toBeLessThanOrEqual(5);
    });
  });
});
