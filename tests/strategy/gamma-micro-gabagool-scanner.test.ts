import { GammaMicroGabagoolScanner, MicroGabagoolOrderbookReader } from '../../src/strategy/gamma-micro-gabagool-scanner';
import { MicroGabagoolTopOfBook } from '../../src/data/micro-gabagool-clob-orderbook-client';

const okResponse = (body: unknown): Promise<Response> => Promise.resolve({
  ok: true,
  status: 200,
  json: async () => body,
} as Response);

const errorResponse = (status: number): Promise<Response> => Promise.resolve({
  ok: false,
  status,
  json: async () => ({}),
} as Response);

function createScanner(params: {
  gammaMarkets: unknown;
  orderbook?: MicroGabagoolOrderbookReader;
  nowMs?: () => number;
  gammaBaseUrl?: string;
  maxMarketsPerScan?: number;
}) {
  const fetchFn = jest.fn().mockImplementation(() => okResponse(params.gammaMarkets));
  const orderbook = params.orderbook ?? {
    getTopOfBook: jest.fn<Promise<MicroGabagoolTopOfBook | null>, [string]>().mockResolvedValue({
      bestBid: 0.4,
      bestAsk: 0.44,
      bestBidSizeUsd: 40,
      bestAskSizeUsd: 22,
    }),
  };

  const scanner = new GammaMicroGabagoolScanner({
    gammaBaseUrl: params.gammaBaseUrl ?? 'https://gamma.test///',
    maxMarketsPerScan: params.maxMarketsPerScan ?? 7,
    fetchFn,
    nowMs: params.nowMs ?? (() => Date.parse('2026-06-01T12:00:00.000Z')),
  }, orderbook);

  return { scanner, fetchFn, orderbook };
}

describe('GammaMicroGabagoolScanner', () => {
  it('fetches expected Gamma URL and returns a valid MarketCandidate from valid Gamma market and orderbook', async () => {
    const now = Date.parse('2026-06-01T12:00:00.000Z');
    const { scanner, fetchFn } = createScanner({
      nowMs: () => now,
      gammaMarkets: [{
        active: true,
        closed: false,
        conditionId: 'condition-1',
        clobTokenIds: ['yes-token-1', 'no-token-1'],
        endDate: new Date(now + 95 * 60_000).toISOString(),
      }],
    });

    await expect(scanner.scan()).resolves.toEqual([{ 
      conditionId: 'condition-1',
      tokenId: 'yes-token-1',
      bestBid: 0.4,
      bestAsk: 0.44,
      bestBidSizeUsd: 40,
      bestAskSizeUsd: 22,
      timeToSettlementMin: 95,
      hasRecentTrades: true,
      wmpDelta3Min: 0,
      spreadChangesLast60Sec: 0,
    }]);
    expect(fetchFn).toHaveBeenCalledWith('https://gamma.test/markets?active=true&closed=false&limit=7');
  });

  it('parses clobTokenIds when it is a JSON string and uses token index 0', async () => {
    const orderbook = {
      getTopOfBook: jest.fn<Promise<MicroGabagoolTopOfBook | null>, [string]>().mockResolvedValue({
        bestBid: 0.41,
        bestAsk: 0.45,
        bestBidSizeUsd: 10,
        bestAskSizeUsd: 20,
      }),
    };
    const { scanner } = createScanner({
      orderbook,
      gammaMarkets: [{
        active: true,
        closed: false,
        conditionId: 'condition-json',
        clobTokenIds: JSON.stringify(['yes-json', 'no-json']),
        endDateIso: '2026-06-01T13:00:00.000Z',
      }],
    });

    const candidates = await scanner.scan();

    expect(orderbook.getTopOfBook).toHaveBeenCalledWith('yes-json');
    expect(candidates).toHaveLength(1);
    expect(candidates[0].tokenId).toBe('yes-json');
  });

  it('skips closed and inactive markets', async () => {
    const { scanner, orderbook } = createScanner({
      gammaMarkets: [
        { active: false, closed: false, conditionId: 'inactive', clobTokenIds: ['yes-1'], endDate: '2026-06-01T13:00:00.000Z' },
        { active: true, closed: true, conditionId: 'closed', clobTokenIds: ['yes-2'], end_date_iso: '2026-06-01T13:00:00.000Z' },
      ],
    });

    await expect(scanner.scan()).resolves.toEqual([]);
    expect(orderbook.getTopOfBook).not.toHaveBeenCalled();
  });

  it('skips market without conditionId', async () => {
    const { scanner, orderbook } = createScanner({
      gammaMarkets: [{ active: true, closed: false, clobTokenIds: ['yes-token'], endDate: '2026-06-01T13:00:00.000Z' }],
    });

    await expect(scanner.scan()).resolves.toEqual([]);
    expect(orderbook.getTopOfBook).not.toHaveBeenCalled();
  });

  it('skips market without YES token id or with malformed clobTokenIds', async () => {
    const { scanner, orderbook } = createScanner({
      gammaMarkets: [
        { active: true, closed: false, conditionId: 'missing', endDate: '2026-06-01T13:00:00.000Z' },
        { active: true, closed: false, conditionId: 'malformed', clobTokenIds: 'not-json', endDate: '2026-06-01T13:00:00.000Z' },
        { active: true, closed: false, conditionId: 'empty', clobTokenIds: [], endDate: '2026-06-01T13:00:00.000Z' },
        { active: true, closed: false, conditionId: 'non-string', clobTokenIds: [123], endDate: '2026-06-01T13:00:00.000Z' },
      ],
    });

    await expect(scanner.scan()).resolves.toEqual([]);
    expect(orderbook.getTopOfBook).not.toHaveBeenCalled();
  });

  it('skips market without valid end date', async () => {
    const { scanner, orderbook } = createScanner({
      gammaMarkets: [
        { active: true, closed: false, conditionId: 'missing-date', clobTokenIds: ['yes-1'] },
        { active: true, closed: false, conditionId: 'invalid-date', clobTokenIds: ['yes-2'], endDate: 'not-a-date' },
      ],
    });

    await expect(scanner.scan()).resolves.toEqual([]);
    expect(orderbook.getTopOfBook).not.toHaveBeenCalled();
  });

  it('does not fail whole scan when one market orderbook fails and returns a valid later market', async () => {
    const orderbook = {
      getTopOfBook: jest.fn<Promise<MicroGabagoolTopOfBook | null>, [string]>()
        .mockRejectedValueOnce(new Error('book failed'))
        .mockResolvedValueOnce({
          bestBid: 0.5,
          bestAsk: 0.55,
          bestBidSizeUsd: 50,
          bestAskSizeUsd: 55,
        }),
    };
    const { scanner } = createScanner({
      orderbook,
      gammaMarkets: [
        { active: true, closed: false, conditionId: 'condition-fail', clobTokenIds: ['yes-fail'], endDate: '2026-06-01T13:00:00.000Z' },
        { active: true, closed: false, conditionId: 'condition-ok', clobTokenIds: ['yes-ok'], endDate: '2026-06-01T13:00:00.000Z' },
      ],
    });

    const candidates = await scanner.scan();

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ conditionId: 'condition-ok', tokenId: 'yes-ok', bestBid: 0.5, bestAsk: 0.55 });
  });

  it('throws on non-ok Gamma response', async () => {
    const fetchFn = jest.fn().mockImplementation(() => errorResponse(503));
    const scanner = new GammaMicroGabagoolScanner({
      gammaBaseUrl: 'https://gamma.test',
      maxMarketsPerScan: 5,
      fetchFn,
      nowMs: () => Date.parse('2026-06-01T12:00:00.000Z'),
    }, { getTopOfBook: jest.fn() });

    await expect(scanner.scan()).rejects.toThrow('Gamma API error: 503');
  });

  it('throws on non-array Gamma response', async () => {
    const { scanner } = createScanner({ gammaMarkets: { markets: [] } });

    await expect(scanner.scan()).rejects.toThrow('Gamma API: unexpected response');
  });

  it('uses rolling stats on repeated scans of the same market', async () => {
    let now = Date.parse('2026-06-01T12:00:00.000Z');
    const fetchFn = jest.fn().mockImplementation(() => okResponse([{
      active: true,
      closed: false,
      conditionId: 'condition-stats',
      clobTokenIds: ['yes-stats'],
      endDate: '2026-06-01T13:00:00.000Z',
    }]));
    const orderbook = {
      getTopOfBook: jest.fn<Promise<MicroGabagoolTopOfBook | null>, [string]>()
        .mockResolvedValueOnce({ bestBid: 0.4, bestAsk: 0.44, bestBidSizeUsd: 40, bestAskSizeUsd: 22 })
        .mockResolvedValueOnce({ bestBid: 0.4, bestAsk: 0.46, bestBidSizeUsd: 40, bestAskSizeUsd: 23 }),
    };
    const scanner = new GammaMicroGabagoolScanner({
      gammaBaseUrl: 'https://gamma.test',
      maxMarketsPerScan: 1,
      fetchFn,
      nowMs: () => now,
    }, orderbook);

    const firstScan = await scanner.scan();
    now += 30_000;
    const secondScan = await scanner.scan();

    expect(firstScan[0].spreadChangesLast60Sec).toBe(0);
    expect(secondScan[0].spreadChangesLast60Sec).toBeGreaterThan(0);
  });
});
