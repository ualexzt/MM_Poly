import { StrategyRunner } from '../../src/strategy/strategy-runner';
import { FixtureScanner } from '../../src/data/gamma-market-scanner';
import { FixtureOrderbookClient } from '../../src/data/clob-orderbook-client';
import { defaultConfig } from '../../src/strategy/config';
import { PaperExecutionEngine } from '../../src/simulation/paper-execution-engine';
import { LiveOrderSubmitter } from '../../src/execution/live-order-submitter';
import { ConsoleLogger } from '../../src/utils/logger';

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
});
