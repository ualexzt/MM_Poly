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
  timeoutMs?: number;
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
    timeoutMs: params.timeoutMs,
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
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toBe('https://gamma.test/markets?active=true&closed=false&limit=7');
    expect(fetchFn.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('accepts timeoutMs config and passes an AbortSignal to Gamma fetch', async () => {
    const { scanner, fetchFn } = createScanner({ gammaMarkets: [], timeoutMs: 123 });

    await expect(scanner.scan()).resolves.toEqual([]);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    expect(fetchFn.mock.calls[0][1]?.signal.aborted).toBe(false);
  });

  it('aborts stalled Gamma fetch after timeoutMs', async () => {
    jest.useFakeTimers();

    try {
      let observedSignal: AbortSignal | undefined;
      const fetchFn = jest.fn((_url: RequestInfo | URL, init?: RequestInit) => {
        observedSignal = init?.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          observedSignal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          }, { once: true });
        });
      });
      const scanner = new GammaMicroGabagoolScanner({
        gammaBaseUrl: 'https://gamma.test',
        maxMarketsPerScan: 5,
        fetchFn,
        nowMs: () => Date.parse('2026-06-01T12:00:00.000Z'),
        timeoutMs: 50,
      }, { getTopOfBook: jest.fn() });

      const scanPromise = scanner.scan();

      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(observedSignal).toBeDefined();
      expect(observedSignal?.aborted).toBe(false);

      const rejection = expect(scanPromise).rejects.toMatchObject({ name: 'AbortError' });
      jest.advanceTimersByTime(50);

      expect(observedSignal?.aborted).toBe(true);
      await rejection;
    } finally {
      jest.useRealTimers();
    }
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

  it('skips market with blank conditionId', async () => {
    const { scanner, orderbook } = createScanner({
      gammaMarkets: [{ active: true, closed: false, conditionId: '   ', clobTokenIds: ['yes-token'], endDate: '2026-06-01T13:00:00.000Z' }],
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

  it('accepts valid active market using end_date_iso', async () => {
    const now = Date.parse('2026-06-01T12:00:00.000Z');
    const { scanner } = createScanner({
      nowMs: () => now,
      gammaMarkets: [{
        active: true,
        closed: false,
        conditionId: 'condition-snake-date',
        clobTokenIds: ['yes-snake-date'],
        end_date_iso: new Date(now + 30 * 60_000).toISOString(),
      }],
    });

    await expect(scanner.scan()).resolves.toEqual([expect.objectContaining({
      conditionId: 'condition-snake-date',
      tokenId: 'yes-snake-date',
      timeToSettlementMin: 30,
    })]);
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

  it('skips invalid top-of-book values', async () => {
    const invalidBooks: MicroGabagoolTopOfBook[] = [
      { bestBid: Number.NaN, bestAsk: 0.5, bestBidSizeUsd: 10, bestAskSizeUsd: 10 },
      { bestBid: 0.4, bestAsk: Number.POSITIVE_INFINITY, bestBidSizeUsd: 10, bestAskSizeUsd: 10 },
      { bestBid: 0.6, bestAsk: 0.5, bestBidSizeUsd: 10, bestAskSizeUsd: 10 },
      { bestBid: 0, bestAsk: 0.5, bestBidSizeUsd: 10, bestAskSizeUsd: 10 },
      { bestBid: 0.4, bestAsk: 1, bestBidSizeUsd: 10, bestAskSizeUsd: 10 },
      { bestBid: 0.4, bestAsk: 0.5, bestBidSizeUsd: 0, bestAskSizeUsd: 10 },
      { bestBid: 0.4, bestAsk: 0.5, bestBidSizeUsd: 10, bestAskSizeUsd: -1 },
    ];
    const orderbook = {
      getTopOfBook: jest.fn<Promise<MicroGabagoolTopOfBook | null>, [string]>()
        .mockImplementation(async () => invalidBooks.shift() ?? null),
    };
    const { scanner } = createScanner({
      orderbook,
      gammaMarkets: [
        { active: true, closed: false, conditionId: 'nan-bid', clobTokenIds: ['yes-1'], endDate: '2026-06-01T13:00:00.000Z' },
        { active: true, closed: false, conditionId: 'infinite-ask', clobTokenIds: ['yes-2'], endDate: '2026-06-01T13:00:00.000Z' },
        { active: true, closed: false, conditionId: 'crossed-book', clobTokenIds: ['yes-3'], endDate: '2026-06-01T13:00:00.000Z' },
        { active: true, closed: false, conditionId: 'zero-bid', clobTokenIds: ['yes-4'], endDate: '2026-06-01T13:00:00.000Z' },
        { active: true, closed: false, conditionId: 'ask-one', clobTokenIds: ['yes-5'], endDate: '2026-06-01T13:00:00.000Z' },
        { active: true, closed: false, conditionId: 'zero-bid-size', clobTokenIds: ['yes-6'], endDate: '2026-06-01T13:00:00.000Z' },
        { active: true, closed: false, conditionId: 'negative-ask-size', clobTokenIds: ['yes-7'], endDate: '2026-06-01T13:00:00.000Z' },
      ],
    });

    await expect(scanner.scan()).resolves.toEqual([]);
    expect(orderbook.getTopOfBook).toHaveBeenCalledTimes(7);
  });

  it('skips null orderbook and returns a valid later market', async () => {
    const orderbook = {
      getTopOfBook: jest.fn<Promise<MicroGabagoolTopOfBook | null>, [string]>()
        .mockResolvedValueOnce(null)
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
        { active: true, closed: false, conditionId: 'condition-null', clobTokenIds: ['yes-null'], endDate: '2026-06-01T13:00:00.000Z' },
        { active: true, closed: false, conditionId: 'condition-ok', clobTokenIds: ['yes-ok'], endDate: '2026-06-01T13:00:00.000Z' },
      ],
    });

    const candidates = await scanner.scan();

    expect(orderbook.getTopOfBook).toHaveBeenCalledTimes(2);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ conditionId: 'condition-ok', tokenId: 'yes-ok', bestBid: 0.5, bestAsk: 0.55 });
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
