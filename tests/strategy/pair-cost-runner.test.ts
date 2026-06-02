import { MarketState } from '../../src/types/market';
import { BookState } from '../../src/types/book';
import {
  DEFAULT_PAIR_COST_STRATEGY_CONFIG,
  InventoryLot,
  PairCostSkipReason,
} from '../../src/engines/pair-cost-types';
import {
  fetchPairOrderbooks,
  runPairCostHedgeCycle,
} from '../../src/strategy/pair-cost-runner';

function makeMarket(overrides: Partial<MarketState> = {}): MarketState {
  return {
    conditionId: 'cid-1',
    slug: 'test-market',
    question: 'Will X happen?',
    yesTokenId: 'yes-1',
    noTokenId: 'no-1',
    active: true,
    closed: false,
    enableOrderBook: true,
    feesEnabled: true,
    volume24hUsd: 1000,
    liquidityUsd: 500,
    oracleAmbiguityScore: 0.05,
    feeRate: 0.02,
    endDate: '2026-01-01T01:00:00.000Z',
    ...overrides,
  };
}

function makeBook(overrides: Partial<BookState> = {}): BookState {
  return {
    tokenId: 'token-1',
    conditionId: 'cid-1',
    bids: [{ price: 0.50, size: 20, sizeUsd: 10 }],
    asks: [{ price: 0.53, size: 20, sizeUsd: 10.6 }],
    bestBid: 0.50,
    bestAsk: 0.53,
    bestBidSizeUsd: 10,
    bestAskSizeUsd: 10.6,
    midpoint: 0.515,
    spread: 0.03,
    spreadTicks: 3,
    depth1Usd: 20.6,
    depth3Usd: 20.6,
    tickSize: 0.01,
    minOrderSize: 1,
    lastUpdateMs: Date.parse('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function lot(overrides: Partial<InventoryLot>): InventoryLot {
  return {
    id: overrides.id ?? 'lot-1',
    marketId: overrides.marketId ?? 'cid-1',
    side: overrides.side ?? 'YES',
    qty: overrides.qty ?? 1,
    remainingQty: overrides.remainingQty ?? overrides.qty ?? 1,
    price: overrides.price ?? 0.45,
    cost: overrides.cost ?? (overrides.remainingQty ?? overrides.qty ?? 1) * (overrides.price ?? 0.45),
    timestamp: overrides.timestamp ?? new Date('2026-01-01T00:00:00.000Z'),
    sourceOrderId: overrides.sourceOrderId ?? null,
  };
}

describe('fetchPairOrderbooks', () => {
  it('returns empty map when no markets provided', async () => {
    const client = { fetchBook: jest.fn() };
    const result = await fetchPairOrderbooks(client, []);
    expect(result.size).toBe(0);
  });

  it('fetches YES and NO books for each market', async () => {
    const yesBook = makeBook({ tokenId: 'yes-1', bestAsk: 0.45 });
    const noBook = makeBook({ tokenId: 'no-1', bestAsk: 0.48 });
    const client = { fetchBook: jest.fn().mockResolvedValueOnce(yesBook).mockResolvedValueOnce(noBook) };
    const markets = [makeMarket()];

    const result = await fetchPairOrderbooks(client, markets);
    expect(result.size).toBe(1);
    expect(result.get('cid-1')).toEqual({ yes: yesBook, no: noBook });
    expect(client.fetchBook).toHaveBeenCalledTimes(2);
    expect(client.fetchBook).toHaveBeenCalledWith('cid-1', 'yes-1');
    expect(client.fetchBook).toHaveBeenCalledWith('cid-1', 'no-1');
  });

  it('skips market when fetch fails', async () => {
    const client = { fetchBook: jest.fn().mockRejectedValueOnce(new Error('timeout')) };
    const markets = [makeMarket()];
    const onError = jest.fn();

    const result = await fetchPairOrderbooks(client, markets, { onError });
    expect(result.size).toBe(0);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'timeout' }), expect.objectContaining({ conditionId: 'cid-1' }));
  });
});

describe('runPairCostHedgeCycle', () => {
  it('logs hedge-completion decisions and market data summary without placing orders', async () => {
    const markets = [makeMarket()];
    const yesBook = makeBook({ tokenId: 'yes-1', bestAsk: 0.20, asks: [{ price: 0.20, size: 20, sizeUsd: 4 }] });
    const noBook = makeBook({ tokenId: 'no-1', bestAsk: 0.53, asks: [{ price: 0.53, size: 10, sizeUsd: 5.3 }] });
    const logger = { write: jest.fn().mockReturnValue(true) };

    const result = await runPairCostHedgeCycle({
      marketScanner: { fetchMarkets: jest.fn().mockResolvedValue(markets) },
      orderbookClient: {
        fetchBook: jest.fn()
          .mockResolvedValueOnce(yesBook)
          .mockResolvedValueOnce(noBook),
      },
      logger,
      lotStore: { getLots: jest.fn().mockResolvedValue([lot({ side: 'YES', qty: 10, remainingQty: 10, price: 0.45 })]) },
      config: {
        strategy: {
          ...DEFAULT_PAIR_COST_STRATEGY_CONFIG,
          enabled: true,
          maxSingleOrderUsd: 20,
          maxTotalMarketExposureUsd: 50,
          maxUnpairedExposureUsd: 20,
          minDepthUsd: 1,
        },
        tradingEnabled: false,
        now: new Date('2026-01-01T00:00:00.000Z'),
      },
    });

    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0].decision).toBe('PLACE_ORDER');
    expect(logger.write).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'pair_cost_market_data',
      marketsFetched: 1,
      marketsEligible: 1,
      booksFetched: 1,
      fetchErrors: 0,
    }));
    expect(logger.write).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'pair_cost_decision',
      marketId: 'cid-1',
      decision: 'PLACE_ORDER',
      candidateSide: 'NO',
    }));
    expect(logger.write).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'pair_cost_order_blocked',
      marketId: 'cid-1',
      reason: 'TRADING_DISABLED',
      wouldPlace: expect.objectContaining({ side: 'NO', action: 'BUY' }),
    }));
  });

  it('does not create first-leg inventory when there are no lots and probe is disabled', async () => {
    const logger = { write: jest.fn().mockReturnValue(true) };

    const result = await runPairCostHedgeCycle({
      marketScanner: { fetchMarkets: jest.fn().mockResolvedValue([makeMarket()]) },
      orderbookClient: {
        fetchBook: jest.fn()
          .mockResolvedValueOnce(makeBook({ tokenId: 'yes-1' }))
          .mockResolvedValueOnce(makeBook({ tokenId: 'no-1' })),
      },
      logger,
      lotStore: { getLots: jest.fn().mockResolvedValue([]) },
      config: {
        strategy: { ...DEFAULT_PAIR_COST_STRATEGY_CONFIG, enabled: true },
        tradingEnabled: false,
        now: new Date('2026-01-01T00:00:00.000Z'),
      },
    });

    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0].reason).toBe(PairCostSkipReason.PROBE_DISABLED);
    expect(logger.write).not.toHaveBeenCalledWith(expect.objectContaining({ eventType: 'pair_cost_order_blocked' }));
  });

  it('logs cycle_error and returns no decisions when market fetch fails', async () => {
    const logger = { write: jest.fn().mockReturnValue(true) };

    const result = await runPairCostHedgeCycle({
      marketScanner: { fetchMarkets: jest.fn().mockRejectedValue(new Error('network')) },
      orderbookClient: { fetchBook: jest.fn() },
      logger,
      lotStore: { getLots: jest.fn() },
      config: {
        strategy: DEFAULT_PAIR_COST_STRATEGY_CONFIG,
        tradingEnabled: false,
        now: new Date('2026-01-01T00:00:00.000Z'),
      },
    });

    expect(result.decisions).toEqual([]);
    expect(logger.write).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'cycle_error',
      strategy: 'pair_cost',
      error: 'network',
    }));
  });
});
