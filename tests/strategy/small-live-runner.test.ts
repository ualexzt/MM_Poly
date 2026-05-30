import { FixtureScanner } from '../../src/data/gamma-market-scanner';
import { FixtureOrderbookClient } from '../../src/data/clob-orderbook-client';
import { LiveOrderSubmitter } from '../../src/execution/live-order-submitter';
import { PaperExecutionEngine } from '../../src/simulation/paper-execution-engine';
import {
  createSmallLiveStrategyRunner,
  buildSmallLiveConfig,
  buildTokenConditionMap,
  createTrackingMarketScanner,
  cancelAllLiveOrders,
  handleLiveUserEvent,
} from '../../src/strategy/small-live-runner';
import type { EnvConfig } from '../../src/config/env';
import type { Logger } from '../../src/utils/logger';
import type { MarketState } from '../../src/types/market';
import type { BookState } from '../../src/types/book';
import { PaperPnlTracker } from '../../src/accounting/paper-pnl-tracker';

const envConfig: EnvConfig = {
  nodeEnv: 'test',
  telegramBotToken: 'test-token',
  telegramChatId: 'test-chat',
  mode: 'small_live',
  minLiquidityUsd: 7000,
  minVolume24hUsd: 12000,
  maxSpreadCents: 7,
  maxExposureUsd: 100,
  maxDrawdownPct: 0.02,
  dailyReportHour: 20,
  dailyReportMinute: 0,
  maxMarkets: 20,
  liveTradingEnabled: true,
};

const silentLogger: Logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  trace: jest.fn(),
};

describe('small-live runner wiring', () => {
  test('builds a guarded small_live config from env overrides', () => {
    const config = buildSmallLiveConfig(envConfig);

    expect(config.mode).toBe('small_live');
    expect(config.liveTradingEnabled).toBe(true);
    expect(config.marketFilter.minLiquidityUsd).toBe(7000);
    expect(config.marketFilter.minVolume24hUsd).toBe(12000);
    expect(config.marketFilter.maxSpreadCents).toBe(7);
    expect(config.inventory.maxTotalStrategyExposureUsd).toBe(25);
    expect(config.risk.maxDailyDrawdownPct).toBe(2);
    expect(config.risk.maxDailyDrawdownUsd).toBe(5);
  });

  test('cancels all live orders through the submitter during shutdown', async () => {
    const mockClient = {
      createAndPostOrder: jest.fn().mockResolvedValue({ orderID: 'unused' }),
      cancelOrder: jest.fn().mockResolvedValue({}),
      getOpenOrders: jest.fn().mockResolvedValue([{ id: 'live-1' }, { orderID: 'live-2' }]),
    };
    const liveSubmitter = new LiveOrderSubmitter(mockClient as any);

    const result = await cancelAllLiveOrders(liveSubmitter, silentLogger);

    expect(result).toEqual({ total: 2, failed: 0, failedOrderIds: [] });
    expect(mockClient.cancelOrder).toHaveBeenCalledWith('live-1');
    expect(mockClient.cancelOrder).toHaveBeenCalledWith('live-2');
  });

  test('returns failed live order cancellations to the caller', async () => {
    const mockClient = {
      createAndPostOrder: jest.fn().mockResolvedValue({ orderID: 'unused' }),
      cancelOrder: jest.fn((orderId: string) => orderId === 'live-2' ? Promise.reject(new Error('cancel failed')) : Promise.resolve({})),
      getOpenOrders: jest.fn().mockResolvedValue([{ id: 'live-1' }, { orderID: 'live-2' }]),
    };
    const liveSubmitter = new LiveOrderSubmitter(mockClient as any);

    const result = await cancelAllLiveOrders(liveSubmitter, silentLogger);

    expect(result).toEqual({ total: 2, failed: 1, failedOrderIds: ['live-2'] });
    expect(silentLogger.error).toHaveBeenCalledWith('Failed to cancel some live orders', {
      failed: 1,
      total: 2,
      failedOrderIds: ['live-2'],
    });
  });

  test('tracking scanner refreshes token-condition mapping on every fetch', async () => {
    const tokenConditionIds = new Map<string, string>();
    const scanner = createTrackingMarketScanner({
      fetchMarkets: jest.fn()
        .mockResolvedValueOnce([
          {
            conditionId: 'cond-1', yesTokenId: 'yes1', noTokenId: 'no1', active: true, closed: false,
            enableOrderBook: true, feesEnabled: true, volume24hUsd: 25000, liquidityUsd: 15000,
            oracleAmbiguityScore: 0.05, resolutionSource: 'https://example.com',
          },
        ])
        .mockResolvedValueOnce([
          {
            conditionId: 'cond-2', yesTokenId: 'yes2', noTokenId: 'no2', active: true, closed: false,
            enableOrderBook: true, feesEnabled: true, volume24hUsd: 25000, liquidityUsd: 15000,
            oracleAmbiguityScore: 0.05, resolutionSource: 'https://example.com',
          },
        ]),
    }, tokenConditionIds);

    await scanner.fetchMarkets();
    expect(tokenConditionIds.get('yes1')).toBe('cond-1');

    await scanner.fetchMarkets();
    expect(tokenConditionIds.has('yes1')).toBe(false);
    expect(tokenConditionIds.get('yes2')).toBe('cond-2');
  });

  test('maps live fill events into strategy inventory and PnL tracking', () => {
    const tokenConditionIds = buildTokenConditionMap([
      {
        conditionId: 'cond-1', yesTokenId: 'yes1', noTokenId: 'no1', active: true, closed: false,
        enableOrderBook: true, feesEnabled: true, volume24hUsd: 25000, liquidityUsd: 15000,
        oracleAmbiguityScore: 0.05, resolutionSource: 'https://example.com',
      },
    ]);
    const runner = { onFill: jest.fn(), onOrderUpdate: jest.fn() };
    const pnlTracker = new PaperPnlTracker(0);

    handleLiveUserEvent(
      {
        type: 'fill',
        data: { orderId: 'live-fill-1', tokenId: 'yes1', side: 'BUY', filledPrice: 0.49, filledSize: 2 },
      },
      { runner, pnlTracker, tokenConditionIds, logger: silentLogger }
    );

    expect(runner.onFill).toHaveBeenCalledWith('cond-1', 'yes1', 'BUY', 0.49, 2);
    expect(pnlTracker.getPosition('yes1')).toMatchObject({ netSize: 2, avgCost: 0.49 });
  });

  test('maps live order terminal events into strategy order-slot reconciliation', () => {
    const runner = { onFill: jest.fn(), onOrderUpdate: jest.fn() };

    handleLiveUserEvent(
      {
        type: 'order',
        data: { orderId: 'live-order-1', status: 'filled' },
      },
      { runner, pnlTracker: new PaperPnlTracker(0), tokenConditionIds: new Map(), logger: silentLogger }
    );

    expect(runner.onOrderUpdate).toHaveBeenCalledWith('live-order-1', 'filled');
  });

  test('creates a strategy runner that routes a valid quote to the live submitter', async () => {
    const mockClient = {
      createAndPostOrder: jest.fn().mockResolvedValue({ orderID: 'live-small-1' }),
      cancelOrder: jest.fn().mockResolvedValue({}),
      getOpenOrders: jest.fn().mockResolvedValue([]),
    };
    const liveSubmitter = new LiveOrderSubmitter(mockClient as any);

    const runner = createSmallLiveStrategyRunner({
      envConfig,
      scanner: new FixtureScanner('../../src/data/fixtures/markets.json'),
      bookClient: new FixtureOrderbookClient('../../src/data/fixtures/orderbook.json'),
      paperEngine: new PaperExecutionEngine(),
      liveSubmitter,
      logger: silentLogger,
    });

    await runner.runCycle();

    expect(mockClient.createAndPostOrder).toHaveBeenCalledWith(
      expect.objectContaining({ tokenID: 'yes1', side: 'BUY' }),
      expect.anything(),
      'GTC'
    );
  });

  test('limits small_live processing to env maxMarkets', async () => {
    const markets: MarketState[] = [
      {
        conditionId: 'cond-1', yesTokenId: 'yes1', noTokenId: 'no1', active: true, closed: false,
        enableOrderBook: true, feesEnabled: true, volume24hUsd: 25000, liquidityUsd: 15000,
        oracleAmbiguityScore: 0.05, resolutionSource: 'https://example.com',
      },
      {
        conditionId: 'cond-2', yesTokenId: 'yes2', noTokenId: 'no2', active: true, closed: false,
        enableOrderBook: true, feesEnabled: true, volume24hUsd: 25000, liquidityUsd: 15000,
        oracleAmbiguityScore: 0.05, resolutionSource: 'https://example.com',
      },
    ];
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
      createAndPostOrder: jest.fn().mockResolvedValue({ orderID: 'live-small-1' }),
      cancelOrder: jest.fn().mockResolvedValue({}),
      getOpenOrders: jest.fn().mockResolvedValue([]),
    };

    const runner = createSmallLiveStrategyRunner({
      envConfig: { ...envConfig, maxMarkets: 1 },
      scanner: { fetchMarkets: async () => markets },
      bookClient,
      paperEngine: new PaperExecutionEngine(),
      liveSubmitter: new LiveOrderSubmitter(mockClient as any),
      logger: silentLogger,
    });

    await runner.runCycle();

    expect(mockClient.createAndPostOrder).toHaveBeenCalledTimes(1);
    expect(mockClient.createAndPostOrder).toHaveBeenCalledWith(
      expect.objectContaining({ tokenID: 'yes1' }),
      expect.anything(),
      'GTC'
    );
  });
});
