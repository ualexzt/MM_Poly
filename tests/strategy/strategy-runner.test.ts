import { StrategyRunner } from '../../src/strategy/strategy-runner';
import { FixtureScanner } from '../../src/data/gamma-market-scanner';
import { FixtureOrderbookClient } from '../../src/data/clob-orderbook-client';
import { defaultConfig } from '../../src/strategy/config';
import { PaperExecutionEngine } from '../../src/simulation/paper-execution-engine';
import { ConsoleLogger } from '../../src/utils/logger';
import { StrategyConfig } from '../../src/types/config';

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

  test('hard limit with SHORT position still quotes BUY to reduce inventory', async () => {
    const paperEngine = new PaperExecutionEngine();
    const config: StrategyConfig = {
      ...defaultConfig,
      inventory: {
        ...defaultConfig.inventory,
        maxMarketExposureUsd: 5,
        hardLimitPct: 65,
      },
    };

    const runner = new StrategyRunner({
      config,
      scanner: new FixtureScanner('../../src/data/fixtures/markets.json'),
      bookClient: new FixtureOrderbookClient('../../src/data/fixtures/orderbook.json'),
      paperEngine,
      logger: new ConsoleLogger(),
    });

    // Build a SHORT position that breaches hard limit
    // 9 contracts @ 0.80 with current price 0.50 = 4.5 USD exposure → 90% > 65% hard limit
    runner.onFill('cond-eligible-1', 'yes1', 'SELL', 0.80, 9);

    await runner.runCycle();

    const openOrders = paperEngine.getOpenOrders();
    const buyOrders = openOrders.filter((o) => o.side === 'BUY');
    const sellOrders = openOrders.filter((o) => o.side === 'SELL');

    // BUY should be quoted because it reduces the SHORT inventory
    expect(buyOrders.length).toBeGreaterThan(0);
    // SELL should NOT be quoted because it increases the SHORT inventory
    expect(sellOrders.length).toBe(0);
  });

  test('hard limit with LONG position still quotes SELL to reduce inventory', async () => {
    const paperEngine = new PaperExecutionEngine();
    const config: StrategyConfig = {
      ...defaultConfig,
      inventory: {
        ...defaultConfig.inventory,
        maxMarketExposureUsd: 5,
        hardLimitPct: 65,
      },
    };

    const runner = new StrategyRunner({
      config,
      scanner: new FixtureScanner('../../src/data/fixtures/markets.json'),
      bookClient: new FixtureOrderbookClient('../../src/data/fixtures/orderbook.json'),
      paperEngine,
      logger: new ConsoleLogger(),
    });

    // Build a LONG position that breaches hard limit
    // 9 contracts @ 0.80 with current price 0.50 = 4.5 USD exposure → 90% > 65% hard limit
    runner.onFill('cond-eligible-1', 'yes1', 'BUY', 0.80, 9);

    await runner.runCycle();

    const openOrders = paperEngine.getOpenOrders();
    const buyOrders = openOrders.filter((o) => o.side === 'BUY');
    const sellOrders = openOrders.filter((o) => o.side === 'SELL');

    // SELL should be quoted because it reduces the LONG inventory
    expect(sellOrders.length).toBeGreaterThan(0);
    // BUY should NOT be quoted because it increases the LONG inventory
    expect(buyOrders.length).toBe(0);
  });
});
