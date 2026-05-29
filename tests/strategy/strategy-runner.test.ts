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
      'GTC'
    );
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

    expect(mockClient.cancelOrder).toHaveBeenCalledWith('buy-2');
    expect(mockClient.cancelOrder).toHaveBeenCalledWith('sell-1');
  });
});
