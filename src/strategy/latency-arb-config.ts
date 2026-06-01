export interface LatencyArbConfig {
  // Live-like shadow soak config
  marketAsset: 'BTC';
  marketDurationMinutes: number;
  startingBalanceUsd: number;
  orderBalanceFraction: number;
  maxOrderSizeUsd: number;
  maxSpreadCents: number;
  maxMarketAgeMs: number;
  simulatedLatencyMs: number;
  logDir: string;

  // Binance feed config
  symbols: string[];

  // Momentum engine config
  lookbackSeconds: number;
  minPriceChangePct: number;
  minVolumeMultiplier: number;
  emaFastPeriod: number;
  emaSlowPeriod: number;

  // Divergence engine config
  minDivergencePct: number;
  minEvPct: number;
  maxEntryPrice: number;
  minEntryPrice: number;

  // Strategy config
  minConfidence: number;
  maxPositionSizeUsd: number;
  maxDailyTrades: number;
  cooldownMs: number;

  // Execution mode
  mode: 'paper' | 'shadow' | 'small_live';
}

export const defaultLatencyArbConfig: LatencyArbConfig = {
  marketAsset: 'BTC',
  marketDurationMinutes: 15,
  startingBalanceUsd: 15.48,
  orderBalanceFraction: 0.10,
  maxOrderSizeUsd: 1.55,
  maxSpreadCents: 8,
  maxMarketAgeMs: 2000,
  simulatedLatencyMs: 750,
  logDir: 'logs',

  symbols: ['btcusdt', 'ethusdt'],

  lookbackSeconds: 60,
  minPriceChangePct: 0.5,
  minVolumeMultiplier: 1.5,
  emaFastPeriod: 5,
  emaSlowPeriod: 20,

  minDivergencePct: 3.0,
  minEvPct: 2.0,
  maxEntryPrice: 0.70,
  minEntryPrice: 0.20,

  minConfidence: 0.6,
  maxPositionSizeUsd: 50,
  maxDailyTrades: 20,
  cooldownMs: 60000,

  mode: 'paper',
};
