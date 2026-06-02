import { GammaApiScanner } from './data/gamma-market-scanner';
import { ClobApiClient } from './data/clob-orderbook-client';
import { JsonlEventWriter } from './accounting/jsonl-event-writer';
import { PairCostConfig } from './engines/pair-cost-scanner';
import { runPairCostScanCycle } from './strategy/pair-cost-runner';

const SCAN_INTERVAL_MS = 30_000;

const DEFAULT_CONFIG: PairCostConfig = {
  maxPairCost: 0.99,
  minEdgeBps: 50,
  minLiquidityUsd: 10,
  feeRate: 0.02,
};

async function main(): Promise<void> {
  const gammaBaseUrl = process.env.GAMMA_API_BASE_URL || 'https://gamma-api.polymarket.com';
  const clobBaseUrl = process.env.CLOB_API_BASE_URL || 'https://clob.polymarket.com';
  const logDir = process.env.PAIR_COST_LOG_DIR || 'logs';

  const marketScanner = new GammaApiScanner(gammaBaseUrl);
  const orderbookClient = new ClobApiClient(clobBaseUrl);
  const logger = new JsonlEventWriter({ logDir, filePrefix: 'pair-cost' });

  console.log(`[pair-cost] scanner starting`);
  console.log(`[pair-cost] gamma=${gammaBaseUrl} clob=${clobBaseUrl}`);
  console.log(`[pair-cost] config: maxPairCost=${DEFAULT_CONFIG.maxPairCost} minEdgeBps=${DEFAULT_CONFIG.minEdgeBps} feeRate=${DEFAULT_CONFIG.feeRate}`);
  console.log(`[pair-cost] scan interval: ${SCAN_INTERVAL_MS / 1000}s`);

  const runCycle = async () => {
    const opportunities = await runPairCostScanCycle(marketScanner, orderbookClient, logger, DEFAULT_CONFIG);
    console.log(`[pair-cost] cycle complete: ${opportunities.length} opportunities found`);
  };

  await runCycle();
  setInterval(runCycle, SCAN_INTERVAL_MS);
}

main().catch((err) => {
  console.error('[pair-cost] fatal error:', err);
  process.exit(1);
});
