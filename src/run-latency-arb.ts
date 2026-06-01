import 'dotenv/config';
import { env, EnvConfig } from './config/env';
import { JsonlEventWriter } from './accounting/jsonl-event-writer';
import { ClobApiClient } from './data/clob-orderbook-client';
import { BookState } from './types/book';
import { MarketState } from './types/market';
import { MomentumSignal } from './engines/momentum-engine';
import { analyzeDivergence } from './engines/divergence-engine';
import { LatencyArbPositionTracker, WouldOrder } from './simulation/latency-arb-position-tracker';
import { LatencyArbShadowExecutor } from './simulation/latency-arb-shadow-executor';
import { LatencyArbConfig } from './strategy/latency-arb-config';
import { buildLatencyArbSnapshot, LatencyArbExecutionSnapshot } from './strategy/latency-arb-orderbook';
import { LatencyArbMarketFetcher, selectLatencyArbMarkets } from './strategy/latency-arb-market-selector';
import { GammaSlugMarketFetcher } from './strategy/gamma-slug-market-fetcher';
import { LatencyArbStrategy } from './strategy/latency-arb-strategy';
import { ConsoleLogger } from './utils/logger';

const logger = new ConsoleLogger();

export function assertLatencyArbModeAllowed(mode: EnvConfig['mode']): void {
  if (mode === 'small_live') {
    throw new Error('Latency arb live mode is disabled until shadow soak is reviewed');
  }
}

export interface RunLatencyArbCycleDeps {
  nowMs: number;
  config: LatencyArbConfig;
  getMomentum: (symbol: string) => MomentumSignal | null;
  marketFetcher: LatencyArbMarketFetcher;
  fetchBook: (conditionId: string, tokenId: string) => Promise<BookState>;
  writeEvent: (event: Record<string, unknown>) => void;
  currentExposureUsd: () => number;
  shadowExecutor?: LatencyArbShadowExecutor;
  onWouldOrder?: (order: WouldOrder) => void;
  onExecutionSnapshot?: (conditionId: string, execution: LatencyArbExecutionSnapshot, nowMs: number) => void;
}

export async function runLatencyArbCycle(deps: RunLatencyArbCycleDeps): Promise<void> {
  const markets = await selectLatencyArbMarkets({
    asset: deps.config.marketAsset,
    durationMinutes: deps.config.marketDurationMinutes,
    maxMarkets: 1,
    nowMs: deps.nowMs,
  }, deps.marketFetcher);

  if (markets.length === 0) {
    deps.writeEvent({ eventType: 'skip', timestamp: deps.nowMs, reason: 'no_eligible_btc_15m_market' });
    return;
  }

  const market = markets[0];
  const momentum = deps.getMomentum('btcusdt');
  if (!momentum) {
    deps.writeEvent({ eventType: 'skip', timestamp: deps.nowMs, conditionId: market.conditionId, reason: 'no_momentum_signal' });
    return;
  }

  const yesBook = await deps.fetchBook(market.conditionId, market.yesTokenId);
  const noBook = await deps.fetchBook(market.conditionId, market.noTokenId);
  const snapshotResult = buildLatencyArbSnapshot({ yes: yesBook, no: noBook }, {
    nowMs: deps.nowMs,
    maxMarketAgeMs: deps.config.maxMarketAgeMs,
    maxSpreadCents: deps.config.maxSpreadCents,
  });

  if (!snapshotResult.ok) {
    deps.writeEvent({ eventType: 'skip', timestamp: deps.nowMs, conditionId: market.conditionId, reason: snapshotResult.reason });
    return;
  }

  deps.onExecutionSnapshot?.(market.conditionId, snapshotResult.execution, deps.nowMs);

  const signal = analyzeDivergence({
    minDivergencePct: deps.config.minDivergencePct,
    minEvPct: deps.config.minEvPct,
    maxEntryPrice: deps.config.maxEntryPrice,
    minEntryPrice: deps.config.minEntryPrice,
  }, momentum, snapshotResult.snapshot, () => deps.nowMs);

  deps.writeEvent({
    eventType: 'signal',
    timestamp: deps.nowMs,
    conditionId: market.conditionId,
    action: signal.action,
    confidence: signal.confidence,
    divergencePct: signal.divergencePct,
    expectedValuePct: signal.expectedValuePct,
    rejectionReason: signal.rejectionReason,
  });

  const executor = deps.shadowExecutor ?? new LatencyArbShadowExecutor({
    mode: deps.config.mode === 'paper' ? 'paper' : 'shadow',
    asset: deps.config.marketAsset,
    duration: '15m',
    startingBalanceUsd: deps.config.startingBalanceUsd,
    orderBalanceFraction: deps.config.orderBalanceFraction,
    maxOrderSizeUsd: deps.config.maxOrderSizeUsd,
    maxPositionUsd: deps.config.maxPositionSizeUsd,
    minConfidence: deps.config.minConfidence,
  }, deps.writeEvent);

  const result = executor.evaluate({
    market,
    signal,
    execution: snapshotResult.execution,
    nowMs: deps.nowMs,
    currentExposureUsd: deps.currentExposureUsd(),
  });

  if (result.ok) {
    deps.onWouldOrder?.(result.order);
  }
}

function latencyModeFromEnv(mode: EnvConfig['mode']): 'paper' | 'shadow' {
  return mode === 'paper' ? 'paper' : 'shadow';
}

async function main() {
  logger.info('=== Latency Arbitrage Strategy ===');

  if (!env.latencyArbEnabled) {
    logger.info('Latency arb is disabled. Set LATENCY_ARB_ENABLED=true to run.');
    process.exit(0);
  }

  assertLatencyArbModeAllowed(env.mode);

  const strategy = new LatencyArbStrategy({
    symbols: env.binanceSymbols,
    binanceWsUrl: env.binanceWsUrl,
    minConfidence: env.latencyArbMinConfidence,
    maxPositionSizeUsd: env.latencyArbMaxPositionUsd,
    maxDailyTrades: env.latencyArbMaxDailyTrades,
    cooldownMs: env.latencyArbCooldownMs,
    mode: latencyModeFromEnv(env.mode),
    marketAsset: env.latencyArbMarketAsset,
    marketDurationMinutes: env.latencyArbMarketDurationMinutes,
    startingBalanceUsd: env.latencyArbStartingBalanceUsd,
    orderBalanceFraction: env.latencyArbOrderBalanceFraction,
    maxOrderSizeUsd: env.latencyArbMaxOrderSizeUsd,
    maxSpreadCents: env.latencyArbMaxSpreadCents,
    maxMarketAgeMs: env.latencyArbMaxMarketAgeMs,
    simulatedLatencyMs: env.latencyArbSimulatedLatencyMs,
    logDir: env.latencyArbLogDir,
  });

  const writer = new JsonlEventWriter({
    logDir: env.latencyArbLogDir,
    filePrefix: 'latency-arb-orders',
    onError: (error) => logger.error('Failed to write latency arb event', { error: error.message }),
  });
  const marketFetcher = new GammaSlugMarketFetcher();
  const bookClient = new ClobApiClient();
  const positionTracker = new LatencyArbPositionTracker(
    { simulatedLatencyMs: env.latencyArbSimulatedLatencyMs },
    (event) => writer.write(event),
  );
  const shadowExecutor = new LatencyArbShadowExecutor({
    mode: latencyModeFromEnv(env.mode),
    asset: env.latencyArbMarketAsset,
    duration: '15m',
    startingBalanceUsd: env.latencyArbStartingBalanceUsd,
    orderBalanceFraction: env.latencyArbOrderBalanceFraction,
    maxOrderSizeUsd: env.latencyArbMaxOrderSizeUsd,
    maxPositionUsd: env.latencyArbMaxPositionUsd,
    minConfidence: env.latencyArbMinConfidence,
  }, (event) => writer.write(event));

  // Handle shutdown
  process.on('SIGINT', () => {
    logger.info('Shutting down...');
    strategy.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    logger.info('Shutting down...');
    strategy.stop();
    process.exit(0);
  });

  strategy.start();

  setInterval(() => {
    runLatencyArbCycle({
      nowMs: Date.now(),
      config: strategy.getConfig(),
      getMomentum: (symbol) => strategy.getMomentum(symbol),
      marketFetcher,
      fetchBook: (conditionId, tokenId) => bookClient.fetchBook(conditionId, tokenId),
      writeEvent: (event) => writer.write(event),
      currentExposureUsd: () => positionTracker.getOpenExposureUsd(),
      shadowExecutor,
      onWouldOrder: (order) => positionTracker.addPendingOrder(order),
      onExecutionSnapshot: (conditionId, execution, nowMs) => {
        positionTracker.processPending(new Map([[conditionId, execution]]), nowMs);
        positionTracker.markToMarket(conditionId, execution, nowMs);
      },
    }).catch((error) => logger.error('Latency arb cycle failed', { error: String(error) }));
  }, 5000);

  // Log stats periodically
  setInterval(() => {
    const stats = strategy.getStats();
    logger.info('Strategy stats', stats);
  }, 60000); // Every minute
}

if (require.main === module) {
  main().catch(err => {
    logger.error('Fatal error', { error: String(err) });
    process.exit(1);
  });
}
