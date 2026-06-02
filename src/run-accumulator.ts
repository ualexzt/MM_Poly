import { FifteenMinMarketScanner } from './data/fifteen-min-scanner';
import { ClobApiClient } from './data/clob-orderbook-client';
import { JsonlEventWriter } from './accounting/jsonl-event-writer';
import { loadLiveModeConfig } from './config/live-mode';
import { runAccumulatorCycle } from './strategy/accumulator-runner';
import { PositionTracker } from './strategy/position-tracker';

const SCAN_INTERVAL_MS = 30_000;

async function fetchAllOrderbooks(client: ClobApiClient, markets: any[]): Promise<Map<string, { yes: any; no: any }>> {
  const result = new Map();
  const fetches: Promise<void>[] = [];

  for (const market of markets) {
    if (!market.yesTokenId || !market.noTokenId) continue;

    fetches.push(
      Promise.all([
        client.fetchBook(market.conditionId, market.yesTokenId),
        client.fetchBook(market.conditionId, market.noTokenId),
      ]).then(([yes, no]) => {
        result.set(market.conditionId, { yes, no });
      }).catch(() => { /* skip failed fetches */ })
    );
  }

  await Promise.all(fetches);
  return result;
}

async function main(): Promise<void> {
  const gammaBaseUrl = process.env.GAMMA_API_BASE_URL || 'https://gamma-api.polymarket.com';
  const clobBaseUrl = process.env.CLOB_API_BASE_URL || 'https://clob.polymarket.com';
  const logDir = process.env.PAIR_COST_LOG_DIR || 'logs';

  const modeConfig = loadLiveModeConfig(process.env);
  const ACCUMULATOR_CONFIG = modeConfig.accumulator;
  const EQUALIZER_CONFIG = modeConfig.equalizer;
  const RISK_CONFIG = modeConfig.risk;

  const marketScanner = new FifteenMinMarketScanner({ gammaBaseUrl });
  const orderbookClient = new ClobApiClient(clobBaseUrl);
  const logger = new JsonlEventWriter({ logDir, filePrefix: 'accumulator' });
  const tracker = new PositionTracker();

  // Paper mode: no real orders
  const paperOrderManager = {
    placeLimitOrder: async (params: any) => {
      console.log(`[paper] would place: ${params.side} ${params.tokenId} @ ${params.price} size=${params.size.toFixed(2)} shares`);
      return { orderId: `paper-${Date.now()}`, status: 'LIVE' as const };
    },
    cancelStaleOrders: async () => [],
    getOpenOrders: async () => [],
  };

  if (modeConfig.canPlaceLiveOrders) {
    throw new Error('small_live execution adapter is not wired yet');
  }

  const orderManager = paperOrderManager;

  console.log(`[accumulator] starting in ${modeConfig.mode.toUpperCase()} mode (15-min markets)`);
  console.log(`[accumulator] gamma=${gammaBaseUrl} clob=${clobBaseUrl}`);
  console.log(`[accumulator] config: targetPairCost=${ACCUMULATOR_CONFIG.targetPairCost} tradeSize=${ACCUMULATOR_CONFIG.tradeSize} maxDelta=${ACCUMULATOR_CONFIG.maxUnhedgedDelta} maxExposure=${RISK_CONFIG.maxExposureUsd}`);
  console.log(`[accumulator] scan interval: ${SCAN_INTERVAL_MS / 1000}s`);

  const runCycle = async () => {
    try {
      const markets = await marketScanner.fetchMarkets();
      console.log(`[accumulator] found ${markets.length} 15-min markets`);

      if (markets.length === 0) {
        console.log(`[accumulator] no markets found (maybe low liquidity hours?)`);
        return;
      }

      const orderbooks = await fetchAllOrderbooks(orderbookClient, markets);
      console.log(`[accumulator] fetched ${orderbooks.size} orderbooks`);

      const result = await runAccumulatorCycle({
        marketScanner,
        orderbookClient,
        orderManager,
        logger,
        accumulatorConfig: ACCUMULATOR_CONFIG,
        equalizerConfig: EQUALIZER_CONFIG,
        riskConfig: RISK_CONFIG,
        currentBalanceUsd: 15,
        tracker,
        getOrderbooks: () => orderbooks,
      });
      console.log(`[accumulator] cycle: ${result.decisions.length} decisions, tracker has ${tracker.getPositions().size} positions`);
    } catch (err) {
      console.error('[accumulator] cycle error:', (err as Error).message);
    }
  };

  await runCycle();
  setInterval(runCycle, SCAN_INTERVAL_MS);
}

main().catch((err) => {
  console.error('[accumulator] fatal error:', err);
  process.exit(1);
});
