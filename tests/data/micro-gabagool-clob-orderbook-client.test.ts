import { MicroGabagoolClobOrderbookClient } from '../../src/data/micro-gabagool-clob-orderbook-client';

const okResponse = (body: unknown) => Promise.resolve({
  ok: true,
  status: 200,
  json: async () => body,
} as Response);

const errorResponse = (status: number) => Promise.resolve({
  ok: false,
  status,
  json: async () => ({}),
} as Response);

describe('MicroGabagoolClobOrderbookClient', () => {
  it('normalizes best bid/ask and USD sizes', async () => {
    const fetchFn = jest.fn().mockImplementation(() => okResponse({
      bids: [{ price: '0.40', size: '100' }],
      asks: [{ price: '0.44', size: '50' }],
    }));
    const client = new MicroGabagoolClobOrderbookClient({ baseUrl: 'https://clob.test', fetchFn });

    const book = await client.getTopOfBook('token-1');

    expect(book).toEqual({ bestBid: 0.40, bestAsk: 0.44, bestBidSizeUsd: 40, bestAskSizeUsd: 22 });
    expect(fetchFn).toHaveBeenCalledWith('https://clob.test/book?token_id=token-1');
  });

  it('trims trailing slashes and URL-encodes token ids', async () => {
    const fetchFn = jest.fn().mockImplementation(() => okResponse({
      bids: [{ price: '0.40', size: '100' }],
      asks: [{ price: '0.44', size: '50' }],
    }));
    const client = new MicroGabagoolClobOrderbookClient({ baseUrl: 'https://clob.test///', fetchFn });

    await client.getTopOfBook('token 1/YES');

    expect(fetchFn).toHaveBeenCalledWith('https://clob.test/book?token_id=token%201%2FYES');
  });

  it('sorts unordered levels conservatively', async () => {
    const fetchFn = jest.fn().mockImplementation(() => okResponse({
      bids: [{ price: '0.39', size: '100' }, { price: '0.41', size: '10' }],
      asks: [{ price: '0.45', size: '50' }, { price: '0.43', size: '20' }],
    }));
    const client = new MicroGabagoolClobOrderbookClient({ baseUrl: 'https://clob.test', fetchFn });

    const book = await client.getTopOfBook('token-1');

    expect(book).toEqual({ bestBid: 0.41, bestAsk: 0.43, bestBidSizeUsd: 4.1, bestAskSizeUsd: 8.6 });
  });

  it('returns null when one side is missing', async () => {
    const fetchFn = jest.fn().mockImplementation(() => okResponse({
      bids: [{ price: '0.40', size: '100' }],
      asks: [],
    }));
    const client = new MicroGabagoolClobOrderbookClient({ baseUrl: 'https://clob.test', fetchFn });

    await expect(client.getTopOfBook('token-1')).resolves.toBeNull();
  });

  it('throws when the CLOB API response is not ok', async () => {
    const fetchFn = jest.fn().mockImplementation(() => errorResponse(503));
    const client = new MicroGabagoolClobOrderbookClient({ baseUrl: 'https://clob.test', fetchFn });

    await expect(client.getTopOfBook('token-1')).rejects.toThrow('CLOB API error: 503');
  });

  it('ignores malformed levels and uses valid remaining top of book', async () => {
    const fetchFn = jest.fn().mockImplementation(() => okResponse({
      bids: [{ price: 'bad', size: '100' }, { price: '0.38', size: '0' }, { price: '0.40', size: '10' }],
      asks: [{ price: '0.43', size: 'bad' }, { price: '0.44', size: '5' }],
    }));
    const client = new MicroGabagoolClobOrderbookClient({ baseUrl: 'https://clob.test', fetchFn });

    const book = await client.getTopOfBook('token-1');

    expect(book).toEqual({ bestBid: 0.40, bestAsk: 0.44, bestBidSizeUsd: 4, bestAskSizeUsd: 2.2 });
  });

  it('returns null when no valid bid or ask remains after parsing', async () => {
    const fetchFn = jest.fn().mockImplementation(() => okResponse({
      bids: [{ price: 'bad', size: '100' }],
      asks: [{ price: '0.44', size: 'not-a-number' }],
    }));
    const client = new MicroGabagoolClobOrderbookClient({ baseUrl: 'https://clob.test', fetchFn });

    await expect(client.getTopOfBook('token-1')).resolves.toBeNull();
  });
});
