import { FixtureScanner } from '../../src/data/gamma-market-scanner';
import { FixtureOrderbookClient } from '../../src/data/clob-orderbook-client';
import { LiveOrderSubmitter } from '../../src/execution/live-order-submitter';
import { PaperExecutionEngine } from '../../src/simulation/paper-execution-engine';
import { createSmallLiveStrategyRunner, buildSmallLiveConfig } from '../../src/strategy/small-live-runner';
import type { EnvConfig } from '../../src/config/env';
import type { Logger } from '../../src/utils/logger';

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
});
