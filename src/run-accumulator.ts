import { GammaApiScanner } from './data/gamma-market-scanner';
import { ClobApiClient } from './data/clob-orderbook-client';
import { JsonlEventWriter } from './accounting/jsonl-event-writer';
import { AccumulatorConfig } from './engines/accumulator';
import { EqualizerConfig } from './engines/equalizer';
import { RiskConfig } from './risk/pair-cost-risk';
import { runAccumulatorCycle } from './strategy/accumulator-runner';
import { PositionTracker } from './strategy/position-tracker';

const SCAN_INTERVAL_MS = 30_000;

const ACCUMULATOR_CONFIG: AccumulatorConfig = {
  maxPairCost: 1.03,
  minEdgeBps: 100,
  maxExposurePerMarketUsd: 5,
  limitOrderOffsetCents: 1,
};

const EQUALIZER_CONFIG: EqualizerConfig = {
  imbalanceThreshold: 1,
  maxExposurePerMarketUsd: 5,
  limitOrderOffsetCents: 1,
};

const RISK_CONFIG: RiskConfig = {
  maxExposureUsd: 12,
  maxExposurePerMarketUsd: 5,
  maxDrawdownPct: 0.20,
  maxOpenOrders: 4,
  startingBalanceUsd: 15,
};

async function fetchAllOrderbooks(client: ClobApiClient, markets: any[]): Promise<Map<string, { yes: any; no: any }>> {
  const result = new Map();
  const fetches: Promise<void>[] = [];

  for (const market of markets.slice(0, 20)) {
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

  const marketScanner = new GammaApiScanner(gammaBaseUrl);
  const orderbookClient = new ClobApiClient(clobBaseUrl);
  const logger = new JsonlEventWriter({ logDir, filePrefix: 'accumulator' });
  const tracker = new PositionTracker();

  // Paper mode: no real orders
  const orderManager = {
    placeLimitOrder: async (params: any) => {
      console.log(`[paper] would place: ${params.side} ${params.tokenId} @ ${params.price} size=$${params.size.toFixed(2)}`);
      return { orderId: `paper-${Date.now()}`, status: 'LIVE' as const };
    },
    cancelStaleOrders: async () => [],
    getOpenOrders: async () => [],
  };

  console.log(`[accumulator] starting in PAPER mode`);
  console.log(`[accumulator] gamma=${gammaBaseUrl} clob=${clobBaseUrl}`);
  console.log(`[accumulator] config: maxPairCost=${ACCUMULATOR_CONFIG.maxPairCost} maxExposure=${RISK_CONFIG.maxExposureUsd}`);
  console.log(`[accumulator] scan interval: ${SCAN_INTERVAL_MS / 1000}s`);

  const runCycle = async () => {
    try {
      const markets = await marketScanner.fetchMarkets();
      const activeMarkets = markets.filter(m => m.active && !m.closed && m.enableOrderBook && m.yesTokenId && m.noTokenId);
      const orderbooks = await fetchAllOrderbooks(orderbookClient, activeMarkets);
      console.log(`[accumulator] fetched ${orderbooks.size} orderbooks from ${activeMarkets.length} active markets`);

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
