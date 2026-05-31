import { StrategyRunner } from '../../src/strategy/strategy-runner';
import { FixtureScanner } from '../../src/data/gamma-market-scanner';
import { FixtureOrderbookClient } from '../../src/data/clob-orderbook-client';
import { defaultConfig } from '../../src/strategy/config';
import { PaperExecutionEngine } from '../../src/simulation/paper-execution-engine';
import { LiveOrderSubmitter } from '../../src/execution/live-order-submitter';
import { ConsoleLogger, Logger } from '../../src/utils/logger';
import { MarketState } from '../../src/types/market';
import { BookState } from '../../src/types/book';

const silentLogger: Logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  trace: jest.fn(),
};

describe('strategy-runner', () => {
  test('runs one cycle in paper mode', async () => {
    const runner = new StrategyRunner({
      config: defaultConfig,
      scanner: new FixtureScanner('../../src/data/fixtures/markets.json'),
      bookClient: new FixtureOrderbookClient('../../src/data/fixtures/orderbook.json'),
      paperEngine: new PaperExecutionEngine(),
      logger: new ConsoleLogger()
    });

    await runner.runCycle();
    expect(true).toBe(true);
  });

  test('routes small_live quotes through the configured live submitter', async () => {
    const mockClient = {
      createAndPostOrder: jest.fn().mockResolvedValue({ orderID: 'live-runner-1' }),
      cancelOrder: jest.fn().mockResolvedValue({}),
      getOpenOrders: jest.fn().mockResolvedValue([]),
    };
    const liveSubmitter = new LiveOrderSubmitter(mockClient as any);
    const config = { ...defaultConfig, mode: 'small_live' as const, liveTradingEnabled: true };

    const runner = new StrategyRunner({
      config,
      scanner: new FixtureScanner('../../src/data/fixtures/markets.json'),
      bookClient: new FixtureOrderbookClient('../../src/data/fixtures/orderbook.json'),
      paperEngine: new PaperExecutionEngine(),
      liveSubmitter,
      logger: new ConsoleLogger()
    });

    await runner.runCycle();

    expect(mockClient.createAndPostOrder).toHaveBeenCalledWith(
      expect.objectContaining({ tokenID: 'yes1', side: 'BUY' }),
      expect.anything(),
      'GTC',
      true
    );
  });

  test('tracks immediate matched live buy so a later cycle can quote sell', async () => {
    const market: MarketState = {
      conditionId: 'cond-immediate-fill', yesTokenId: 'yes-immediate', noTokenId: 'no-immediate', active: true, closed: false,
      enableOrderBook: true, feesEnabled: true, volume24hUsd: 25000, liquidityUsd: 15000,
      oracleAmbiguityScore: 0.05, resolutionSource: 'https://example.com',
    };
    const bookClient = {
      async fetchBook(conditionId: string, tokenId: string): Promise<BookState> {
        return {
          tokenId, conditionId,
          bids: [{ price: 0.24, size: 100, sizeUsd: 24 }],
          asks: [{ price: 0.30, size: 100, sizeUsd: 30 }],
          bestBid: 0.24, bestAsk: 0.30,
          bestBidSizeUsd: 24, bestAskSizeUsd: 30,
          midpoint: 0.27, spread: 0.06, spreadTicks: 6,
          depth1Usd: 100, depth3Usd: 500,
          tickSize: 0.01, minOrderSize: 5,
          lastUpdateMs: Date.now(),
        };
      },
    };
    const mockClient = {
      createAndPostOrder: jest.fn()
        .mockResolvedValueOnce({ orderID: 'buy-filled', status: 'matched', takingAmount: '6', makingAmount: '1.5' })
        .mockResolvedValue({ orderID: 'sell-live', status: 'live' }),
      cancelOrder: jest.fn().mockResolvedValue({}),
      getOpenOrders: jest.fn().mockResolvedValue([]),
    };
    const runner = new StrategyRunner({
      config: {
        ...defaultConfig,
        mode: 'small_live' as const,
        liveTradingEnabled: true,
        size: {
          ...defaultConfig.size,
          baseOrderSizeUsd: 2,
          maxOrderSizeUsd: 3,
        },
      },
      scanner: { fetchMarkets: async () => [market] },
      bookClient,
      paperEngine: new PaperExecutionEngine(),
      liveSubmitter: new LiveOrderSubmitter(mockClient as any),
      logger: silentLogger,
    });

    await runner.runCycle();

    expect(runner.getInventory().getTokenBalance(market.yesTokenId)).toBe(6);

    mockClient.createAndPostOrder.mockClear();
    await runner.runCycle();

    expect(mockClient.createAndPostOrder).toHaveBeenCalledWith(
      expect.objectContaining({ tokenID: market.yesTokenId, side: 'SELL' }),
      expect.anything(),
      'GTC',
      true
    );
  });

  test('tries additional basic markets when first market fails book filters', async () => {
    const badMarket: MarketState = {
      conditionId: 'cond-bad-book', yesTokenId: 'yes-bad-book', noTokenId: 'no-bad-book', active: true, closed: false,
      enableOrderBook: true, feesEnabled: true, volume24hUsd: 25000, liquidityUsd: 15000,
      oracleAmbiguityScore: 0.05, resolutionSource: 'https://example.com',
    };
    const goodMarket: MarketState = {
      conditionId: 'cond-good-book', yesTokenId: 'yes-good-book', noTokenId: 'no-good-book', active: true, closed: false,
      enableOrderBook: true, feesEnabled: true, volume24hUsd: 25000, liquidityUsd: 15000,
      oracleAmbiguityScore: 0.05, resolutionSource: 'https://example.com',
    };
    const makeBook = (conditionId: string, tokenId: string, overrides: Partial<BookState> = {}): BookState => ({
      tokenId, conditionId,
      bids: [{ price: 0.45, size: 100, sizeUsd: 45 }],
      asks: [{ price: 0.55, size: 100, sizeUsd: 55 }],
      bestBid: 0.45, bestAsk: 0.55,
      bestBidSizeUsd: 45, bestAskSizeUsd: 55,
      midpoint: 0.50, spread: 0.10, spreadTicks: 10,
      depth1Usd: 100, depth3Usd: 500,
      tickSize: 0.01, minOrderSize: 1,
      lastUpdateMs: Date.now(),
      ...overrides,
    });
    const bookClient = {
      fetchBook: jest.fn(async (conditionId: string, tokenId: string) => {
        if (conditionId === badMarket.conditionId) return makeBook(conditionId, tokenId, { depth1Usd: 1, depth3Usd: 1 });
        return makeBook(conditionId, tokenId);
      }),
    };
    const mockClient = {
      createAndPostOrder: jest.fn().mockResolvedValue({ orderID: 'good-live-order' }),
      cancelOrder: jest.fn().mockResolvedValue({}),
      getOpenOrders: jest.fn().mockResolvedValue([]),
    };
    const runner = new StrategyRunner({
      config: { ...defaultConfig, mode: 'small_live' as const, liveTradingEnabled: true },
      scanner: { fetchMarkets: async () => [badMarket, goodMarket] },
      bookClient,
      paperEngine: new PaperExecutionEngine(),
      liveSubmitter: new LiveOrderSubmitter(mockClient as any),
      logger: silentLogger,
      maxMarkets: 1,
    });

    await runner.runCycle();

    expect(mockClient.createAndPostOrder).toHaveBeenCalledWith(
      expect.objectContaining({ tokenID: goodMarket.yesTokenId, side: 'BUY' }),
      expect.anything(),
      'GTC',
      true
    );
  });

  test('fetches fresh books even when a stale cached book exists', async () => {
    const market: MarketState = {
      conditionId: 'cond-refresh', yesTokenId: 'yes-refresh', noTokenId: 'no-refresh', active: true, closed: false,
      enableOrderBook: true, feesEnabled: true, volume24hUsd: 25000, liquidityUsd: 15000,
      oracleAmbiguityScore: 0.05, resolutionSource: 'https://example.com',
    };
    const freshBook = (conditionId: string, tokenId: string): BookState => ({
      tokenId, conditionId,
      bids: [{ price: 0.45, size: 100, sizeUsd: 45 }],
      asks: [{ price: 0.55, size: 100, sizeUsd: 55 }],
      bestBid: 0.45, bestAsk: 0.55,
      bestBidSizeUsd: 45, bestAskSizeUsd: 55,
      midpoint: 0.50, spread: 0.10, spreadTicks: 10,
      depth1Usd: 100, depth3Usd: 500,
      tickSize: 0.01, minOrderSize: 1,
      lastUpdateMs: Date.now(),
    });
    const mockClient = {
      createAndPostOrder: jest.fn().mockResolvedValue({ orderID: 'fresh-live-order' }),
      cancelOrder: jest.fn().mockResolvedValue({}),
      getOpenOrders: jest.fn().mockResolvedValue([]),
    };
    const runner = new StrategyRunner({
      config: { ...defaultConfig, mode: 'small_live' as const, liveTradingEnabled: true },
      scanner: { fetchMarkets: async () => [market] },
      bookClient: { fetchBook: jest.fn(async (conditionId: string, tokenId: string) => freshBook(conditionId, tokenId)) },
      paperEngine: new PaperExecutionEngine(),
      liveSubmitter: new LiveOrderSubmitter(mockClient as any),
      logger: silentLogger,
    });
    runner.updateBook(market.yesTokenId, { ...freshBook(market.conditionId, market.yesTokenId), lastUpdateMs: Date.now() - 100_000 });
    runner.updateBook(market.noTokenId, { ...freshBook(market.conditionId, market.noTokenId), lastUpdateMs: Date.now() - 100_000 });

    await runner.runCycle();

    expect(mockClient.createAndPostOrder).toHaveBeenCalledWith(
      expect.objectContaining({ tokenID: 'yes-refresh', side: 'BUY' }),
      expect.anything(),
      'GTC',
      true
    );
  });

  test('cancels live orders for markets that leave the active universe', async () => {
    const market: MarketState = {
      conditionId: 'cond-dropped', yesTokenId: 'yes-dropped', noTokenId: 'no-dropped', active: true, closed: false,
      enableOrderBook: true, feesEnabled: true, volume24hUsd: 25000, liquidityUsd: 15000,
      oracleAmbiguityScore: 0.05, resolutionSource: 'https://example.com',
    };
    let markets = [market];
    const bookClient = {
      async fetchBook(conditionId: string, tokenId: string): Promise<BookState> {
        return {
          tokenId, conditionId,
          bids: [{ price: 0.45, size: 100, sizeUsd: 45 }],
          asks: [{ price: 0.55, size: 100, sizeUsd: 55 }],
          bestBid: 0.45, bestAsk: 0.55,
          bestBidSizeUsd: 45, bestAskSizeUsd: 55,
          midpoint: 0.50, spread: 0.10, spreadTicks: 10,
          depth1Usd: 100, depth3Usd: 500,
          tickSize: 0.01, minOrderSize: 1,
          lastUpdateMs: Date.now(),
        };
      },
    };
    const mockClient = {
      createAndPostOrder: jest.fn().mockResolvedValue({ orderID: 'dropped-live-order' }),
      cancelOrder: jest.fn().mockResolvedValue({}),
      getOpenOrders: jest.fn().mockResolvedValue([]),
    };
    const runner = new StrategyRunner({
      config: { ...defaultConfig, mode: 'small_live' as const, liveTradingEnabled: true },
      scanner: { fetchMarkets: async () => markets },
      bookClient,
      paperEngine: new PaperExecutionEngine(),
      liveSubmitter: new LiveOrderSubmitter(mockClient as any),
      logger: silentLogger,
    });

    await runner.runCycle();
    markets = [];
    await runner.runCycle();

    expect(mockClient.cancelOrder).toHaveBeenCalledWith({ orderID: 'dropped-live-order' });
  });

  test('cancels existing inventory-increasing live order when hard inventory limit is reached', async () => {
    const market: MarketState = {
      conditionId: 'cond-hard-limit', yesTokenId: 'yes-hard', noTokenId: 'no-hard', active: true, closed: false,
      enableOrderBook: true, feesEnabled: true, volume24hUsd: 25000, liquidityUsd: 15000,
      oracleAmbiguityScore: 0.05, resolutionSource: 'https://example.com',
    };
    const bookClient = {
      async fetchBook(conditionId: string, tokenId: string): Promise<BookState> {
        return {
          tokenId, conditionId,
          bids: [{ price: 0.45, size: 100, sizeUsd: 45 }],
          asks: [{ price: 0.55, size: 100, sizeUsd: 55 }],
          bestBid: 0.45, bestAsk: 0.55,
          bestBidSizeUsd: 45, bestAskSizeUsd: 55,
          midpoint: 0.50, spread: 0.10, spreadTicks: 10,
          depth1Usd: 100, depth3Usd: 500,
          tickSize: 0.01, minOrderSize: 1,
          lastUpdateMs: Date.now(),
        };
      },
    };
    const mockClient = {
      createAndPostOrder: jest.fn().mockResolvedValue({ orderID: 'buy-increasing' }),
      cancelOrder: jest.fn().mockResolvedValue({}),
      getOpenOrders: jest.fn().mockResolvedValue([]),
    };
    const runner = new StrategyRunner({
      config: { ...defaultConfig, mode: 'small_live' as const, liveTradingEnabled: true },
      scanner: { fetchMarkets: async () => [market] },
      bookClient,
      paperEngine: new PaperExecutionEngine(),
      liveSubmitter: new LiveOrderSubmitter(mockClient as any),
      logger: silentLogger,
    });

    await runner.runCycle();
    runner.onFill(market.conditionId, market.yesTokenId, 'BUY', 0.49, 10);
    await runner.runCycle();

    expect(mockClient.cancelOrder).toHaveBeenCalledWith({ orderID: 'buy-increasing' });
  });

  test('clears filled live order slots before the next quote cycle', async () => {
    const market: MarketState = {
      conditionId: 'cond-slot-clear', yesTokenId: 'yes-slot', noTokenId: 'no-slot', active: true, closed: false,
      enableOrderBook: true, feesEnabled: true, volume24hUsd: 25000, liquidityUsd: 15000,
      oracleAmbiguityScore: 0.05, resolutionSource: 'https://example.com',
    };
    const bookClient = {
      async fetchBook(conditionId: string, tokenId: string): Promise<BookState> {
        return {
          tokenId, conditionId,
          bids: [{ price: 0.45, size: 100, sizeUsd: 45 }],
          asks: [{ price: 0.55, size: 100, sizeUsd: 55 }],
          bestBid: 0.45, bestAsk: 0.55,
          bestBidSizeUsd: 45, bestAskSizeUsd: 55,
          midpoint: 0.50, spread: 0.10, spreadTicks: 10,
          depth1Usd: 100, depth3Usd: 500,
          tickSize: 0.01, minOrderSize: 1,
          lastUpdateMs: Date.now(),
        };
      },
    };
    const mockClient = {
      createAndPostOrder: jest.fn()
        .mockResolvedValueOnce({ orderID: 'buy-filled' })
        .mockResolvedValueOnce({ orderID: 'buy-replacement' }),
      cancelOrder: jest.fn().mockResolvedValue({}),
      getOpenOrders: jest.fn().mockResolvedValue([]),
    };
    const runner = new StrategyRunner({
      config: { ...defaultConfig, mode: 'small_live' as const, liveTradingEnabled: true },
      scanner: { fetchMarkets: async () => [market] },
      bookClient,
      paperEngine: new PaperExecutionEngine(),
      liveSubmitter: new LiveOrderSubmitter(mockClient as any),
      logger: silentLogger,
    });

    await runner.runCycle();
    runner.onOrderUpdate('buy-filled', 'canceled');
    await runner.runCycle();

    expect(mockClient.cancelOrder).not.toHaveBeenCalledWith('buy-filled');
    expect(mockClient.createAndPostOrder).toHaveBeenCalledWith(
      expect.objectContaining({ tokenID: 'yes-slot', side: 'BUY' }),
      expect.anything(),
      'GTC',
      true
    );
  });

  test('skips live quoting when the NO book used for fair price is stale', async () => {
    const market: MarketState = {
      conditionId: 'cond-stale-no', yesTokenId: 'yes-stale-no', noTokenId: 'no-stale-no', active: true, closed: false,
      enableOrderBook: true, feesEnabled: true, volume24hUsd: 25000, liquidityUsd: 15000,
      oracleAmbiguityScore: 0.05, resolutionSource: 'https://example.com',
    };
    const bookClient = {
      async fetchBook(conditionId: string, tokenId: string): Promise<BookState> {
        return {
          tokenId, conditionId,
          bids: [{ price: 0.45, size: 100, sizeUsd: 45 }],
          asks: [{ price: 0.55, size: 100, sizeUsd: 55 }],
          bestBid: 0.45, bestAsk: 0.55,
          bestBidSizeUsd: 45, bestAskSizeUsd: 55,
          midpoint: 0.50, spread: 0.10, spreadTicks: 10,
          depth1Usd: 100, depth3Usd: 500,
          tickSize: 0.01, minOrderSize: 1,
          lastUpdateMs: tokenId === 'no-stale-no' ? Date.now() - 100_000 : Date.now(),
        };
      },
    };
    const mockClient = {
      createAndPostOrder: jest.fn().mockResolvedValue({ orderID: 'should-not-submit' }),
      cancelOrder: jest.fn().mockResolvedValue({}),
      getOpenOrders: jest.fn().mockResolvedValue([]),
    };
    const runner = new StrategyRunner({
      config: { ...defaultConfig, mode: 'small_live' as const, liveTradingEnabled: true },
      scanner: { fetchMarkets: async () => [market] },
      bookClient,
      paperEngine: new PaperExecutionEngine(),
      liveSubmitter: new LiveOrderSubmitter(mockClient as any),
      logger: silentLogger,
    });

    await runner.runCycle();

    expect(mockClient.createAndPostOrder).not.toHaveBeenCalled();
    expect(silentLogger.warn).toHaveBeenCalledWith('Stale book — skipping market', { conditionId: market.conditionId });
  });

  test('does not keep cancelling a live order after cancel succeeded but replacement submit failed', async () => {
    const market: MarketState = {
      conditionId: 'cond-submit-fail', yesTokenId: 'yes-submit-fail', noTokenId: 'no-submit-fail', active: true, closed: false,
      enableOrderBook: true, feesEnabled: true, volume24hUsd: 25000, liquidityUsd: 15000,
      oracleAmbiguityScore: 0.05, resolutionSource: 'https://example.com',
    };
    const bookClient = {
      async fetchBook(conditionId: string, tokenId: string): Promise<BookState> {
        return {
          tokenId, conditionId,
          bids: [{ price: 0.45, size: 100, sizeUsd: 45 }],
          asks: [{ price: 0.55, size: 100, sizeUsd: 55 }],
          bestBid: 0.45, bestAsk: 0.55,
          bestBidSizeUsd: 45, bestAskSizeUsd: 55,
          midpoint: 0.50, spread: 0.10, spreadTicks: 10,
          depth1Usd: 100, depth3Usd: 500,
          tickSize: 0.01, minOrderSize: 1,
          lastUpdateMs: Date.now(),
        };
      },
    };
    const mockClient = {
      createAndPostOrder: jest.fn()
        .mockResolvedValueOnce({ orderID: 'old-live-order' })
        .mockRejectedValueOnce(new Error('submit failed after cancel'))
        .mockResolvedValueOnce({ orderID: 'replacement-live-order' }),
      cancelOrder: jest.fn().mockResolvedValue({}),
      getOpenOrders: jest.fn().mockResolvedValue([]),
    };
    const runner = new StrategyRunner({
      config: { ...defaultConfig, mode: 'small_live' as const, liveTradingEnabled: true },
      scanner: { fetchMarkets: async () => [market] },
      bookClient,
      paperEngine: new PaperExecutionEngine(),
      liveSubmitter: new LiveOrderSubmitter(mockClient as any),
      logger: silentLogger,
    });

    await runner.runCycle();
    await runner.runCycle();
    await runner.runCycle();

    expect(mockClient.cancelOrder).toHaveBeenCalledTimes(1);
    expect(mockClient.cancelOrder).toHaveBeenCalledWith({ orderID: 'old-live-order' });
    expect(mockClient.createAndPostOrder).toHaveBeenCalledWith(
      expect.objectContaining({ tokenID: 'yes-submit-fail', side: 'BUY' }),
      expect.anything(),
      'GTC',
      true
    );
  });

  test('cancels live orders and skips market processing when user ws has never connected', async () => {
    const scanner = { fetchMarkets: jest.fn().mockResolvedValue([]) };
    const bookClient = { fetchBook: jest.fn() };
    const mockClient = {
      createAndPostOrder: jest.fn().mockResolvedValue({ orderID: 'should-not-submit' }),
      cancelOrder: jest.fn().mockResolvedValue({}),
      getOpenOrders: jest.fn().mockResolvedValue([{ id: 'live-to-cancel' }]),
    };
    const runner = new StrategyRunner({
      config: { ...defaultConfig, mode: 'small_live' as const, liveTradingEnabled: true },
      scanner,
      bookClient,
      paperEngine: new PaperExecutionEngine(),
      liveSubmitter: new LiveOrderSubmitter(mockClient as any),
      logger: silentLogger,
    });

    await runner.runCycle({ connected: false, disconnectedAt: null });

    expect(mockClient.getOpenOrders).toHaveBeenCalledTimes(1);
    expect(mockClient.cancelOrder).toHaveBeenCalledWith({ orderID: 'live-to-cancel' });
    expect(scanner.fetchMarkets).not.toHaveBeenCalled();
    expect(bookClient.fetchBook).not.toHaveBeenCalled();
    expect(mockClient.createAndPostOrder).not.toHaveBeenCalled();
  });

  test('attempts to cancel both live sides even when one cancel fails', async () => {
    const market: MarketState = {
      conditionId: 'cond-live-cancel', yesTokenId: 'yes-live', noTokenId: 'no-live', active: true, closed: false,
      enableOrderBook: true, feesEnabled: true, volume24hUsd: 25000, liquidityUsd: 15000,
      oracleAmbiguityScore: 0.05, resolutionSource: 'https://example.com',
    };
    let stale = false;
    const bookClient = {
      async fetchBook(conditionId: string, tokenId: string): Promise<BookState> {
        return {
          tokenId, conditionId,
          bids: [{ price: 0.45, size: 100, sizeUsd: 45 }],
          asks: [{ price: 0.55, size: 100, sizeUsd: 55 }],
          bestBid: 0.45, bestAsk: 0.55,
          bestBidSizeUsd: 45, bestAskSizeUsd: 55,
          midpoint: 0.50, spread: 0.10, spreadTicks: 10,
          depth1Usd: 100, depth3Usd: 500,
          tickSize: 0.01, minOrderSize: 1,
          lastUpdateMs: stale ? Date.now() - 100_000 : Date.now(),
        };
      },
    };
    const mockClient = {
      createAndPostOrder: jest.fn()
        .mockResolvedValueOnce({ orderID: 'buy-1' })
        .mockResolvedValueOnce({ orderID: 'buy-2' })
        .mockResolvedValueOnce({ orderID: 'sell-1' }),
      cancelOrder: jest.fn((orderId: string) => orderId === 'buy-2' ? Promise.reject(new Error('cancel failed')) : Promise.resolve({})),
      getOpenOrders: jest.fn().mockResolvedValue([]),
    };
    const config = {
      ...defaultConfig,
      mode: 'small_live' as const,
      liveTradingEnabled: true,
      inventory: {
        ...defaultConfig.inventory,
        maxMarketExposureUsd: 100,
        maxEventExposureUsd: 100,
        maxTotalStrategyExposureUsd: 100,
        softLimitPct: 80,
        reduceOnlyLimitPct: 90,
        hardLimitPct: 95,
      },
    };
    const runner = new StrategyRunner({
      config,
      scanner: { fetchMarkets: async () => [market] },
      bookClient,
      paperEngine: new PaperExecutionEngine(),
      liveSubmitter: new LiveOrderSubmitter(mockClient as any),
      logger: silentLogger,
    });

    await runner.runCycle();
    runner.onFill(market.conditionId, market.yesTokenId, 'BUY', 0.49, 10);
    await runner.runCycle();
    stale = true;
    await runner.runCycle();

    expect(mockClient.cancelOrder).toHaveBeenCalledWith({ orderID: 'buy-2' });
    expect(mockClient.cancelOrder).toHaveBeenCalledWith({ orderID: 'sell-1' });
  });
});
