import { StrategyRunner } from './strategy/strategy-runner';
import { FixtureScanner } from './data/gamma-market-scanner';
import { FixtureOrderbookClient } from './data/clob-orderbook-client';
import { PaperExecutionEngine } from './simulation/paper-execution-engine';
import { defaultConfig } from './strategy/config';
import { ConsoleLogger } from './utils/logger';

async function main() {
  console.log('=== Polymarket MM Strategy — Paper Mode ===');
  console.log(`Mode: ${defaultConfig.mode}`);
  console.log(`Live trading enabled: ${defaultConfig.liveTradingEnabled}`);
  console.log('');

  const paperEngine = new PaperExecutionEngine();
  const runner = new StrategyRunner({
    config: defaultConfig,
    scanner: new FixtureScanner(),
    bookClient: new FixtureOrderbookClient(),
    paperEngine,
    logger: new ConsoleLogger()
  });

  await runner.runCycle();

  const orders = paperEngine.getOpenOrders();
  console.log('\n=== Open Paper Orders ===');
  console.log(`Total orders: ${orders.length}`);
  for (const o of orders) {
    console.log(`  ${o.side} ${o.size} @ ${o.price} (${o.tokenId})`);
  }

  // Simulate some trades to show fills
  console.log('\n=== Simulating trades ===');
  const fills1 = paperEngine.onTrade({ tokenId: 'yes1', price: 0.43, size: 3 });
  console.log(`Trade @ 0.43: ${fills1.length} fills`);

  const fills2 = paperEngine.onTrade({ tokenId: 'yes1', price: 0.47, size: 5 });
  console.log(`Trade @ 0.47: ${fills2.length} fills`);

  console.log('\n=== Remaining orders ===');
  const remaining = paperEngine.getOpenOrders();
  console.log(`Total orders: ${remaining.length}`);
  for (const o of remaining) {
    console.log(`  ${o.side} ${o.size} @ ${o.price} (${o.tokenId})`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
