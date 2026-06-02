import { PairCostAnalyticsConfig } from '../analytics/pair-cost-analytics';
import {
  DEFAULT_PAIR_COST_STRATEGY_CONFIG,
  PairCostStrategyConfig,
} from '../engines/pair-cost-types';

export interface PairCostRuntimeConfig {
  strategy: PairCostStrategyConfig;
  tradingEnabled: boolean;
  maxMarkets: number;
  scanIntervalMs: number;
  analytics: PairCostAnalyticsConfig;
}

function boolEnv(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw.toLowerCase() === 'true';
}

function numberEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return value;
}

function nullableNumberEnv(env: NodeJS.ProcessEnv, name: string, fallback: number | null): number | null {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return value;
}

function numberListEnv(env: NodeJS.ProcessEnv, name: string, fallback: number[]): number[] {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const values = raw
    .split(',')
    .map(part => Number(part.trim()))
    .filter(value => Number.isFinite(value) && value > 0);
  return values.length > 0 ? values : fallback;
}

export function loadPairCostRuntimeConfig(env: NodeJS.ProcessEnv): PairCostRuntimeConfig {
  return {
    strategy: {
      ...DEFAULT_PAIR_COST_STRATEGY_CONFIG,
      enabled: boolEnv(env, 'PAIR_COST_ENABLED', DEFAULT_PAIR_COST_STRATEGY_CONFIG.enabled),
      maxPairCost: numberEnv(env, 'PAIR_COST_MAX_PAIR_COST', DEFAULT_PAIR_COST_STRATEGY_CONFIG.maxPairCost),
      targetPairCost: numberEnv(env, 'PAIR_COST_TARGET_PAIR_COST', DEFAULT_PAIR_COST_STRATEGY_CONFIG.targetPairCost),
      minEdgePerPair: numberEnv(env, 'PAIR_COST_MIN_EDGE_PER_PAIR', DEFAULT_PAIR_COST_STRATEGY_CONFIG.minEdgePerPair),
      maxTotalMarketExposureUsd: numberEnv(env, 'PAIR_COST_MAX_TOTAL_MARKET_EXPOSURE_USD', DEFAULT_PAIR_COST_STRATEGY_CONFIG.maxTotalMarketExposureUsd),
      maxUnpairedExposureUsd: numberEnv(env, 'PAIR_COST_MAX_UNPAIRED_EXPOSURE_USD', DEFAULT_PAIR_COST_STRATEGY_CONFIG.maxUnpairedExposureUsd),
      maxSingleOrderUsd: numberEnv(env, 'PAIR_COST_MAX_SINGLE_ORDER_USD', DEFAULT_PAIR_COST_STRATEGY_CONFIG.maxSingleOrderUsd),
      maxSingleOrderQty: nullableNumberEnv(env, 'PAIR_COST_MAX_SINGLE_ORDER_QTY', DEFAULT_PAIR_COST_STRATEGY_CONFIG.maxSingleOrderQty),
      maxUnpairedHoldSeconds: numberEnv(env, 'PAIR_COST_MAX_UNPAIRED_HOLD_SECONDS', DEFAULT_PAIR_COST_STRATEGY_CONFIG.maxUnpairedHoldSeconds),
      noNewPairLastSeconds: numberEnv(env, 'PAIR_COST_NO_NEW_PAIR_LAST_SECONDS', DEFAULT_PAIR_COST_STRATEGY_CONFIG.noNewPairLastSeconds),
      noNewProbeLastSeconds: numberEnv(env, 'PAIR_COST_NO_NEW_PROBE_LAST_SECONDS', DEFAULT_PAIR_COST_STRATEGY_CONFIG.noNewProbeLastSeconds),
      partialFillTimeoutMs: numberEnv(env, 'PAIR_COST_PARTIAL_FILL_TIMEOUT_MS', DEFAULT_PAIR_COST_STRATEGY_CONFIG.partialFillTimeoutMs),
      cancelReplaceCooldownMs: numberEnv(env, 'PAIR_COST_CANCEL_REPLACE_COOLDOWN_MS', DEFAULT_PAIR_COST_STRATEGY_CONFIG.cancelReplaceCooldownMs),
      maxSpread: numberEnv(env, 'PAIR_COST_MAX_SPREAD', DEFAULT_PAIR_COST_STRATEGY_CONFIG.maxSpread),
      minDepthUsd: numberEnv(env, 'PAIR_COST_MIN_DEPTH_USD', DEFAULT_PAIR_COST_STRATEGY_CONFIG.minDepthUsd),
      orderbookStaleMs: numberEnv(env, 'PAIR_COST_ORDERBOOK_STALE_MS', DEFAULT_PAIR_COST_STRATEGY_CONFIG.orderbookStaleMs),
      orderMode: env.PAIR_COST_ORDER_MODE === 'IOC' ? 'IOC' : 'POST_ONLY',
      allowTakerForHedgeCompletion: boolEnv(env, 'PAIR_COST_ALLOW_TAKER_FOR_HEDGE_COMPLETION', DEFAULT_PAIR_COST_STRATEGY_CONFIG.allowTakerForHedgeCompletion),
      allowProbeMode: boolEnv(env, 'PAIR_COST_ALLOW_PROBE_MODE', DEFAULT_PAIR_COST_STRATEGY_CONFIG.allowProbeMode),
      probeEnabled: boolEnv(env, 'PAIR_COST_PROBE_ENABLED', DEFAULT_PAIR_COST_STRATEGY_CONFIG.probeEnabled),
      maxProbeExposureUsd: numberEnv(env, 'PAIR_COST_MAX_PROBE_EXPOSURE_USD', DEFAULT_PAIR_COST_STRATEGY_CONFIG.maxProbeExposureUsd),
      minProbeMispricing: numberEnv(env, 'PAIR_COST_MIN_PROBE_MISPRICING', DEFAULT_PAIR_COST_STRATEGY_CONFIG.minProbeMispricing),
      maxProbeHoldSeconds: numberEnv(env, 'PAIR_COST_MAX_PROBE_HOLD_SECONDS', DEFAULT_PAIR_COST_STRATEGY_CONFIG.maxProbeHoldSeconds),
      reduceOnlyOnTimeout: boolEnv(env, 'PAIR_COST_REDUCE_ONLY_ON_TIMEOUT', DEFAULT_PAIR_COST_STRATEGY_CONFIG.reduceOnlyOnTimeout),
      stopOnMarketResolutionRisk: boolEnv(env, 'PAIR_COST_STOP_ON_MARKET_RESOLUTION_RISK', DEFAULT_PAIR_COST_STRATEGY_CONFIG.stopOnMarketResolutionRisk),
      stopOnOrderbookStale: boolEnv(env, 'PAIR_COST_STOP_ON_ORDERBOOK_STALE', DEFAULT_PAIR_COST_STRATEGY_CONFIG.stopOnOrderbookStale),
    },
    tradingEnabled: boolEnv(env, 'PAIR_COST_TRADING_ENABLED', false),
    maxMarkets: Math.max(1, Math.floor(numberEnv(env, 'PAIR_COST_MAX_MARKETS', 20))),
    scanIntervalMs: Math.max(1000, Math.floor(numberEnv(env, 'PAIR_COST_SCAN_INTERVAL_MS', 30_000))),
    analytics: {
      enabled: boolEnv(env, 'PAIR_COST_ANALYTICS_ENABLED', true),
      sampleUsd: numberListEnv(env, 'PAIR_COST_ANALYTICS_SAMPLE_USD', [0.5, 1, 2, 3, 5]),
      maxPairCost: numberEnv(env, 'PAIR_COST_ANALYTICS_MAX_PAIR_COST', numberEnv(env, 'PAIR_COST_MAX_PAIR_COST', DEFAULT_PAIR_COST_STRATEGY_CONFIG.maxPairCost)),
      minEdgePerPair: numberEnv(env, 'PAIR_COST_ANALYTICS_MIN_EDGE_PER_PAIR', numberEnv(env, 'PAIR_COST_MIN_EDGE_PER_PAIR', DEFAULT_PAIR_COST_STRATEGY_CONFIG.minEdgePerPair)),
    },
  };
}
