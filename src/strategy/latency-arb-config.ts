export interface LatencyArbConfig {
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
