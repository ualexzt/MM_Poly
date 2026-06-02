import { GammaApiScanner } from './data/gamma-market-scanner';
import { ClobApiClient } from './data/clob-orderbook-client';
import { JsonlEventWriter } from './accounting/jsonl-event-writer';
import { loadPairCostRuntimeConfig } from './config/pair-cost-runtime';
import { EmptyPairCostLotStore, runPairCostHedgeCycle } from './strategy/pair-cost-runner';

async function main(): Promise<void> {
  const gammaBaseUrl = process.env.GAMMA_API_BASE_URL || 'https://gamma-api.polymarket.com';
  const clobBaseUrl = process.env.CLOB_API_BASE_URL || 'https://clob.polymarket.com';
  const logDir = process.env.PAIR_COST_LOG_DIR || 'logs';
  const runtimeConfig = loadPairCostRuntimeConfig(process.env);

  if (runtimeConfig.tradingEnabled) {
    throw new Error('PAIR_COST_TRADING_ENABLED=true is not supported by this data-only runner');
  }

  const marketScanner = new GammaApiScanner(gammaBaseUrl);
  const orderbookClient = new ClobApiClient(clobBaseUrl);
  const logger = new JsonlEventWriter({ logDir, filePrefix: 'pair-cost' });
  const lotStore = new EmptyPairCostLotStore();

  console.log('[pair-cost] hedge-completion data runner starting');
  console.log(`[pair-cost] gamma=${gammaBaseUrl} clob=${clobBaseUrl}`);
  console.log(`[pair-cost] enabled=${runtimeConfig.strategy.enabled} tradingEnabled=${runtimeConfig.tradingEnabled} probeEnabled=${runtimeConfig.strategy.probeEnabled} allowProbeMode=${runtimeConfig.strategy.allowProbeMode}`);
  console.log(`[pair-cost] maxMarkets=${runtimeConfig.maxMarkets} maxPairCost=${runtimeConfig.strategy.maxPairCost} minEdge=${runtimeConfig.strategy.minEdgePerPair}`);
  console.log(`[pair-cost] scan interval: ${runtimeConfig.scanIntervalMs / 1000}s`);

  const runCycle = async () => {
    const result = await runPairCostHedgeCycle({
      marketScanner,
      orderbookClient,
      logger,
      lotStore,
      config: {
        strategy: runtimeConfig.strategy,
        tradingEnabled: runtimeConfig.tradingEnabled,
        maxMarkets: runtimeConfig.maxMarkets,
      },
    });

    console.log(`[pair-cost] cycle: marketsFetched=${result.marketsFetched} eligible=${result.marketsEligible} books=${result.booksFetched} fetchErrors=${result.fetchErrors} decisions=${result.decisions.length}`);
  };

  await runCycle();
  setInterval(() => {
    runCycle().catch((err) => {
      console.error('[pair-cost] cycle error:', (err as Error).message);
    });
  }, runtimeConfig.scanIntervalMs);
}

main().catch((err) => {
  console.error('[pair-cost] fatal error:', err);
  process.exit(1);
});
