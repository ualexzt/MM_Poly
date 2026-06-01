export interface MicroGabagoolConfig {
  // Mode
  mode: 'paper' | 'live';
  enableLiveTrading: boolean;

  // Balance
  initialBalanceUsd: number;
  activeTradingCapitalUsd: number;
  reserveBalanceUsd: number;
  gasReserveUsd: number;

  // Order sizing
  orderSizeMinUsd: number;
  orderSizeMaxUsd: number;
  maxPositionPerMarketUsd: number;
  maxTotalExposureUsd: number;
  maxActiveMarkets: number;

  // Timing
  maxOrderAgeSeconds: number;
  maxPositionAgeSeconds: number;
  defensiveExitTimeoutSeconds: number;

  // Risk
  maxDailyLossUsd: number;
  dailyProfitTargetMinUsd: number;
  dailyProfitTargetMaxUsd: number;
  consecutiveLossLimit: number;

  // Platform
  tickSize: number;
  minProfitThresholdUsd: number;
  gasPerRoundtripEstimateUsd: number;
  makerRebateRate: number;

  // Market filters
  minSpread: number;
  maxSpread: number;
  minBid: number;
  maxAsk: number;
  minTimeToSettlementMinutes: number;
  minTopOfBookSizeUsd: number;
  recentTradeWindowMinutes: number;

  // Scoring
  minScoreToTrade: number;

  // Cooldown
  marketCooldownAfterLossMinutes: number;
  marketCooldownAfterTwoBadExitsMinutes: number;

  // API resilience
  apiMaxRetries: number;
  apiRetryBaseDelaySeconds: number;
  apiRetryMaxDelaySeconds: number;
  reconcileOnReconnect: boolean;
}

export const DEFAULT_CONFIG: MicroGabagoolConfig = {
  mode: 'paper',
  enableLiveTrading: false,

  initialBalanceUsd: 15.0,
  activeTradingCapitalUsd: 10.0,
  reserveBalanceUsd: 5.0,
  gasReserveUsd: 0.5,

  orderSizeMinUsd: 1.0,
  orderSizeMaxUsd: 1.5,
  maxPositionPerMarketUsd: 3.0,
  maxTotalExposureUsd: 6.0,
  maxActiveMarkets: 2,

  maxOrderAgeSeconds: 45,
  maxPositionAgeSeconds: 300,
  defensiveExitTimeoutSeconds: 600,

  maxDailyLossUsd: 1.50,
  dailyProfitTargetMinUsd: 0.30,
  dailyProfitTargetMaxUsd: 0.75,
  consecutiveLossLimit: 3,

  tickSize: 0.01,
  minProfitThresholdUsd: 0.005,
  gasPerRoundtripEstimateUsd: 0.004,
  makerRebateRate: 0.001,

  minSpread: 0.02,
  maxSpread: 0.05,
  minBid: 0.08,
  maxAsk: 0.92,
  minTimeToSettlementMinutes: 15,
  minTopOfBookSizeUsd: 10.0,
  recentTradeWindowMinutes: 5,

  minScoreToTrade: 7.5,

  marketCooldownAfterLossMinutes: 30,
  marketCooldownAfterTwoBadExitsMinutes: 60,

  apiMaxRetries: 4,
  apiRetryBaseDelaySeconds: 1,
  apiRetryMaxDelaySeconds: 8,
  reconcileOnReconnect: true,
};
