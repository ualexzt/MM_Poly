import { BookState } from '../../src/types/book';
import { getExecutableBuyPrice } from '../../src/engines/executable-price';

function makeBook(overrides: Partial<BookState> = {}): BookState {
  return {
    tokenId: 'token-1',
    conditionId: 'market-1',
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

describe('getExecutableBuyPrice', () => {
  it('walks asks and returns weighted average executable price for requested quantity', () => {
    const book = makeBook({
      asks: [
        { price: 0.43, size: 2, sizeUsd: 0.86 },
        { price: 0.44, size: 3, sizeUsd: 1.32 },
        { price: 0.46, size: 10, sizeUsd: 4.6 },
      ],
    });

    const result = getExecutableBuyPrice(book, 'NO', 5);

    expect(result).toEqual(expect.objectContaining({
      requestedQty: 5,
      executableQty: 5,
      avgPrice: 0.436,
      totalCost: 2.18,
      worstPrice: 0.44,
      enoughDepth: true,
    }));
    expect(result.levelsUsed).toEqual([
      { price: 0.43, size: 2, sizeUsd: 0.86 },
      { price: 0.44, size: 3, sizeUsd: 1.32 },
    ]);
  });

  it('returns enoughDepth false when asks cannot fully satisfy quantity', () => {
    const book = makeBook({
      asks: [
        { price: 0.43, size: 2, sizeUsd: 0.86 },
        { price: 0.44, size: 3, sizeUsd: 1.32 },
      ],
    });

    const result = getExecutableBuyPrice(book, 'YES', 10);

    expect(result.requestedQty).toBe(10);
    expect(result.executableQty).toBe(5);
    expect(result.avgPrice).toBeCloseTo(0.436);
    expect(result.enoughDepth).toBe(false);
  });
});
