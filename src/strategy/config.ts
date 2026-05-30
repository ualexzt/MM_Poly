import { StrategyConfig } from '../types/config';

export const defaultConfig: StrategyConfig = {
  mode: 'paper',
  liveTradingEnabled: false,
  fairPrice: {
    weights: { microprice: 0.45, midpoint: 0.25, complement: 0.20, lastTradeEma: 0.10, externalSignal: 0.00 },
    complementConsistencyToleranceCents: 2.0
  },
  marketFilter: {
    active: true, closed: false, enableOrderBook: true, feesEnabled: true,
    midpointMin: 0.15, midpointMax: 0.85,
    minVolume24hUsd: 10000, minLiquidityUsd: 5000,
    minBestLevelDepthUsd: 100, minDepth3LevelsUsd: 500,
    minSpreadTicks: 3, maxSpreadCents: 100,
    minTimeToResolutionMinutes: 90, disableNearResolutionMinutes: 30,
    maxOracleAmbiguityScore: 0.20, requireValidResolutionSource: false
  },
  spread: {
    minHalfSpreadTicks: 1, baseHalfSpreadCents: 1.0,
    volatilityMultiplier: 0.8, adverseSelectionBufferCents: 0.5,
    toxicityWideningMaxCents: 3.0, inventoryWideningMaxCents: 3.5,
    rewardTighteningMaxCents: 0.5
  },
  size: {
    baseOrderSizeUsd: 1, maxOrderSizeUsd: 1.5,
    minSizeMultiplierOverExchangeMin: 1.2,
    respectRewardMinIncentiveSize: true
  },
  inventory: {
    maxMarketExposureUsd: 3, maxEventExposureUsd: 10,
    maxTotalStrategyExposureUsd: 25,
    softLimitPct: 15, reduceOnlyLimitPct: 35, hardLimitPct: 50,
    maxSkewCents: 4.5, skewSensitivity: 0.70,
    throttleProfiles: {
      paper: {
        reduceOnlyThresholdPct: 50,
        tiers: [
          { startPct: 25, sizeMultiplier: 0.5, extraHalfSpreadCents: 0.5 },
          { startPct: 35, sizeMultiplier: 0.25, extraHalfSpreadCents: 1.5 },
          { startPct: 45, sizeMultiplier: 0.05, extraHalfSpreadCents: 3.0, blockNewInventory: true },
        ],
      },
      small_live: {
        reduceOnlyThresholdPct: 35,
        tiers: [
          { startPct: 15, sizeMultiplier: 0.5, extraHalfSpreadCents: 0.75 },
          { startPct: 25, sizeMultiplier: 0.2, extraHalfSpreadCents: 2.0 },
          { startPct: 35, sizeMultiplier: 0.05, extraHalfSpreadCents: 4.0, blockNewInventory: true },
        ],
      },
    }
  },
  toxicity: {
    cancelIfMidpointMoves10sCentsGte: 1.0,
    cancelIfMidpointMoves60sCentsGte: 3.0,
    cancelIfLargeTradeUsdGte: 1000,
    cancelIfHashChanges10sGte: 8,
    cancelIfSpreadTicksLte: 1,
    cooldownAfterCancelSeconds: 30
  },
  risk: {
    maxDailyDrawdownPct: 2, maxDailyDrawdownUsd: 5, maxStrategyDrawdownPct: 5,
    maxConsecutiveAdverseFills: 4,
    cancelAllOnWsDisconnectSeconds: 3,
    cancelAllOnApiErrorRatePct: 20,
    cancelAllOnTickSizeChange: true,
    disableNearResolutionMinutes: 30
  },
  paperExecution: {
    queueAheadSize: 5,
    fillFractionAfterQueue: 0.5,
  },
  refreshIntervalMs: 1000,
  staleOrderMaxAgeMs: 2500,
  minQuoteLifetimeMs: 500,
  maxQuoteLifetimeMs: 10000
};
