import { StrategyRunner } from '../../src/strategy/strategy-runner';
import { FixtureScanner } from '../../src/data/gamma-market-scanner';
import { FixtureOrderbookClient } from '../../src/data/clob-orderbook-client';
import { PaperExecutionEngine } from '../../src/simulation/paper-execution-engine';
import { defaultConfig } from '../../src/strategy/config';
import { ConsoleLogger } from '../../src/utils/logger';

describe('paper-pipeline integration', () => {
  test('full cycle: load markets, select, quote, paper submit, simulate trade, check state', async () => {
    const paperEngine = new PaperExecutionEngine();
    const runner = new StrategyRunner({
      config: defaultConfig,
      scanner: new FixtureScanner('../../src/data/fixtures/markets.json'),
      bookClient: new FixtureOrderbookClient('../../src/data/fixtures/orderbook.json'),
      paperEngine,
      logger: new ConsoleLogger()
    });

    await runner.runCycle();
    const openOrders = paperEngine.getOpenOrders();
    expect(openOrders.length).toBeGreaterThan(0);

    const fills = paperEngine.onTrade({ tokenId: 'yes1', price: 0.48, size: 5 });
    expect(fills.length).toBeGreaterThan(0);
  });
});
