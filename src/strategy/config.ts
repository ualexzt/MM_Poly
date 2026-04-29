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
    minSpreadTicks: 3, maxSpreadCents: 8,
    minTimeToResolutionMinutes: 90, disableNearResolutionMinutes: 30,
    maxOracleAmbiguityScore: 0.20, requireValidResolutionSource: false
  },
  spread: {
    minHalfSpreadTicks: 1, baseHalfSpreadCents: 1.0,
    volatilityMultiplier: 0.8, adverseSelectionBufferCents: 0.5,
    toxicityWideningMaxCents: 3.0, inventoryWideningMaxCents: 2.0,
    rewardTighteningMaxCents: 0.5
  },
  size: {
    baseOrderSizeUsd: 1, maxOrderSizeUsd: 2.5,
    minSizeMultiplierOverExchangeMin: 1.2,
    respectRewardMinIncentiveSize: true
  },
  inventory: {
    maxMarketExposureUsd: 10, maxEventExposureUsd: 25,
    maxTotalStrategyExposureUsd: 100,
    softLimitPct: 35, hardLimitPct: 65,
    maxSkewCents: 3.0, skewSensitivity: 0.35
  },
  toxicity: {
    cancelIfMidpointMoves10sCentsGte: 1.5,
    cancelIfMidpointMoves60sCentsGte: 3.0,
    cancelIfLargeTradeUsdGte: 1000,
    cancelIfHashChanges10sGte: 8,
    cancelIfSpreadTicksLte: 1,
    cooldownAfterCancelSeconds: 20
  },
  risk: {
    maxDailyDrawdownPct: 2, maxStrategyDrawdownPct: 5,
    maxConsecutiveAdverseFills: 4,
    cancelAllOnWsDisconnectSeconds: 3,
    cancelAllOnApiErrorRatePct: 20,
    cancelAllOnTickSizeChange: true,
    disableNearResolutionMinutes: 30
  },
  refreshIntervalMs: 1000,
  staleOrderMaxAgeMs: 2500,
  minQuoteLifetimeMs: 500,
  maxQuoteLifetimeMs: 10000
};
