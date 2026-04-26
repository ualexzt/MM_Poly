export interface FairPriceWeights {
  microprice: number;
  midpoint: number;
  complement: number;
  lastTradeEma: number;
  externalSignal: number;
}

export interface MarketFilterConfig {
  active: boolean;
  closed: boolean;
  enableOrderBook: boolean;
  feesEnabled: boolean;
  midpointMin: number;
  midpointMax: number;
  minVolume24hUsd: number;
  minLiquidityUsd: number;
  minBestLevelDepthUsd: number;
  minDepth3LevelsUsd: number;
  minSpreadTicks: number;
  maxSpreadCents: number;
  minTimeToResolutionMinutes: number;
  disableNearResolutionMinutes: number;
  maxOracleAmbiguityScore: number;
  requireValidResolutionSource: boolean;
}

export interface SpreadConfig {
  minHalfSpreadTicks: number;
  baseHalfSpreadCents: number;
  volatilityMultiplier: number;
  adverseSelectionBufferCents: number;
  toxicityWideningMaxCents: number;
  inventoryWideningMaxCents: number;
  rewardTighteningMaxCents: number;
}

export interface SizeConfig {
  baseOrderSizeUsd: number;
  maxOrderSizeUsd: number;
  minSizeMultiplierOverExchangeMin: number;
  respectRewardMinIncentiveSize: boolean;
}

export interface InventoryConfig {
  maxMarketExposureUsd: number;
  maxEventExposureUsd: number;
  maxTotalStrategyExposureUsd: number;
  softLimitPct: number;
  hardLimitPct: number;
  maxSkewCents: number;
  skewSensitivity: number;
}

export interface ToxicityConfig {
  cancelIfMidpointMoves10sCentsGte: number;
  cancelIfMidpointMoves60sCentsGte: number;
  cancelIfLargeTradeUsdGte: number;
  cancelIfHashChanges10sGte: number;
  cancelIfSpreadTicksLte: number;
  cooldownAfterCancelSeconds: number;
}

export interface RiskConfig {
  maxDailyDrawdownPct: number;
  maxStrategyDrawdownPct: number;
  maxConsecutiveAdverseFills: number;
  cancelAllOnWsDisconnectSeconds: number;
  cancelAllOnApiErrorRatePct: number;
  cancelAllOnTickSizeChange: boolean;
  disableNearResolutionMinutes: number;
}

export interface StrategyConfig {
  mode: 'paper' | 'shadow' | 'small_live' | 'disabled';
  liveTradingEnabled: boolean;
  fairPrice: {
    weights: FairPriceWeights;
    complementConsistencyToleranceCents: number;
  };
  marketFilter: MarketFilterConfig;
  spread: SpreadConfig;
  size: SizeConfig;
  inventory: InventoryConfig;
  toxicity: ToxicityConfig;
  risk: RiskConfig;
  refreshIntervalMs: number;
  staleOrderMaxAgeMs: number;
  minQuoteLifetimeMs: number;
  maxQuoteLifetimeMs: number;
}
