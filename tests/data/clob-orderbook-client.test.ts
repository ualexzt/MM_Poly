import { ClobApiClient } from '../../src/data/clob-orderbook-client';

describe('ClobApiClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('normalizes raw book levels to best bid and best ask regardless of API order', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        bids: [
          { price: '0.01', size: '100' },
          { price: '0.45', size: '10' },
          { price: '0.30', size: '20' },
        ],
        asks: [
          { price: '0.99', size: '100' },
          { price: '0.55', size: '10' },
          { price: '0.70', size: '20' },
        ],
        tick_size: '0.01',
        min_order_size: '5',
        hash: 'book-hash',
      }),
    }) as any;

    const client = new ClobApiClient('https://clob.example');
    const book = await client.fetchBook('cond-1', 'token-1');

    expect(book.bestBid).toBe(0.45);
    expect(book.bestAsk).toBe(0.55);
    expect(book.midpoint).toBe(0.5);
    expect(book.spread).toBeCloseTo(0.10);
    expect(book.spreadTicks).toBe(10);
    expect(book.bids.map((level) => level.price)).toEqual([0.45, 0.30, 0.01]);
    expect(book.asks.map((level) => level.price)).toEqual([0.55, 0.70, 0.99]);
  });
});
