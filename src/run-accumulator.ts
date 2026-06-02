import { ClobClient, Chain } from '@polymarket/clob-client-v2';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { polygon } from 'viem/chains';
import { FifteenMinMarketScanner } from './data/fifteen-min-scanner';
import { ClobApiClient } from './data/clob-orderbook-client';
import { WsMarketOrderbookClient } from './data/ws-market-orderbook';
import { JsonlEventWriter } from './accounting/jsonl-event-writer';
import { loadLiveModeConfig } from './config/live-mode';
import { applyObservedFills, normalizeClobTradesToObservedFills } from './execution/live-fill-tracker';
import { OrderManager } from './execution/order-manager';
import { PolymarketLiveOrderClient } from './execution/polymarket-live-order-client';
import { runAccumulatorCycle } from './strategy/accumulator-runner';
import { PositionTracker } from './strategy/position-tracker';
import { BookState } from './types/book';

const SCAN_INTERVAL_MS = 30_000;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for small_live`);
  return value;
}

function createSmallLiveDependencies(clobBaseUrl: string): { orderManager: OrderManager; clobClient: ClobClient } {
  const privateKey = requireEnv('PRIVATE_KEY');
  const walletAddress = requireEnv('WALLET_ADDRESS');
  const creds = {
    key: requireEnv('CLOB_API_KEY'),
    secret: requireEnv('CLOB_API_SECRET'),
    passphrase: requireEnv('CLOB_API_PASSPHRASE'),
  };

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const walletClient = createWalletClient({ account, chain: polygon, transport: http() });
  const clobClient = new ClobClient({
    host: clobBaseUrl,
    chain: Chain.POLYGON,
    signer: walletClient as any,
    creds,
    signatureType: 3,
    funderAddress: walletAddress,
  });

  return { orderManager: new OrderManager(new PolymarketLiveOrderClient(clobClient as any)), clobClient };
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

  const liveDependencies = modeConfig.canPlaceLiveOrders ? createSmallLiveDependencies(clobBaseUrl) : null;
  const orderManager = liveDependencies ? liveDependencies.orderManager : paperOrderManager;
  const seenFillIds = new Set<string>();

  // WebSocket orderbook cache (real-time, replaces stale REST polling)
  const wsOrderbooks = new WsMarketOrderbookClient();
  let wsConnected = false;
  wsOrderbooks.connect().then(() => {
    wsConnected = true;
    console.log('[accumulator] WebSocket orderbook connected');
  }).catch((err) => {
    console.error('[accumulator] WebSocket connection failed, falling back to REST:', (err as Error).message);
  });

  // Resolve orderbooks: prefer WS cache, fall back to REST
  async function resolveOrderbooks(markets: any[]): Promise<Map<string, { yes: BookState; no: BookState }>> {
    const allIds: string[] = [];
    for (const m of markets) {
      if (m.yesTokenId) allIds.push(m.yesTokenId);
      if (m.noTokenId) allIds.push(m.noTokenId);
    }
    if (wsConnected) {
      wsOrderbooks.subscribe(allIds);
    }

    const result = new Map<string, { yes: BookState; no: BookState }>();
    let wsHits = 0;
    let restFetches = 0;

    for (const market of markets) {
      if (!market.yesTokenId || !market.noTokenId) continue;

      const wsYes = wsOrderbooks.getBook(market.yesTokenId);
      const wsNo = wsOrderbooks.getBook(market.noTokenId);

      if (wsYes && wsNo) {
        result.set(market.conditionId, { yes: wsYes, no: wsNo });
        wsHits++;
      } else {
        // Fall back to REST for books not yet in WS cache
        try {
          const [yes, no] = await Promise.all([
            orderbookClient.fetchBook(market.conditionId, market.yesTokenId),
            orderbookClient.fetchBook(market.conditionId, market.noTokenId),
          ]);
          result.set(market.conditionId, { yes, no });
          restFetches++;
        } catch {
          // skip failed fetches
        }
      }
    }

    if (wsHits > 0 || restFetches > 0) {
      console.log(`[accumulator] orderbooks: ${wsHits} WS cache, ${restFetches} REST fallback`);
    }
    return result;
  }

  console.log(`[accumulator] starting in ${modeConfig.canPlaceLiveOrders ? 'SMALL_LIVE' : 'PAPER'} mode (15-min markets)`);
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

      if (liveDependencies) {
        for (const market of markets) {
          try {
            const trades = await liveDependencies.clobClient.getTrades({ market: market.conditionId }, true);
            const marketEndMs = market.endDate ? Date.parse(market.endDate) : undefined;
            const fills = normalizeClobTradesToObservedFills(trades as any[], {
              marketId: market.conditionId,
              yesTokenId: market.yesTokenId,
              noTokenId: market.noTokenId,
              marketEndMs,
            });
            const applied = applyObservedFills(tracker, fills, seenFillIds);
            for (const fill of applied) {
              logger.write({ eventType: 'live_fill_observed', ...fill });
            }
          } catch (err) {
            logger.write({ eventType: 'live_fill_error', marketId: market.conditionId, error: (err as Error).message });
          }
        }
      }

      const orderbooks = await resolveOrderbooks(markets);

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
        recordFillOnOrderPlacement: !modeConfig.canPlaceLiveOrders,
        postOnlyOrders: process.env.POST_ONLY_ORDERS === 'true',
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
