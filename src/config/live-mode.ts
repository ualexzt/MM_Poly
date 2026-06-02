import { AccumulatorConfig } from '../engines/accumulator';
import { EqualizerConfig } from '../engines/equalizer';
import { RiskConfig } from '../risk/pair-cost-risk';

export type TradingMode = 'paper' | 'small_live';

export interface LiveModeConfig {
  mode: TradingMode;
  liveEnabled: boolean;
  canPlaceLiveOrders: boolean;
  accumulator: AccumulatorConfig;
  equalizer: EqualizerConfig;
  risk: RiskConfig;
}

const PAPER_ACCUMULATOR: AccumulatorConfig = {
  targetPairCost: 0.98,
  tradeSize: 2,
  maxUnhedgedDelta: 4,
  minLiquidityMultiplier: 3,
  maxExposurePerMarketUsd: 5,
};

const PAPER_EQUALIZER: EqualizerConfig = {
  imbalanceThreshold: 1,
  tradeSize: 2,
  maxPairCost: 0.99,
};

const PAPER_RISK: RiskConfig = {
  maxExposureUsd: 12,
  maxExposurePerMarketUsd: 5,
  maxDrawdownPct: 0.20,
  maxOpenOrders: 4,
  startingBalanceUsd: 15,
};

const SMALL_LIVE_ACCUMULATOR: AccumulatorConfig = {
  targetPairCost: 0.98,
  tradeSize: 2,
  maxUnhedgedDelta: 2,
  minLiquidityMultiplier: 3,
  maxExposurePerMarketUsd: 2,
};

const SMALL_LIVE_EQUALIZER: EqualizerConfig = {
  imbalanceThreshold: 0,
  tradeSize: 2,
  maxPairCost: 0.99,
};

const SMALL_LIVE_RISK: RiskConfig = {
  maxExposureUsd: 2,
  maxExposurePerMarketUsd: 2,
  maxDrawdownPct: 0.20,
  maxOpenOrders: 1,
  startingBalanceUsd: 15,
};

export function loadLiveModeConfig(env: NodeJS.ProcessEnv): LiveModeConfig {
  const mode: TradingMode = env.TRADING_MODE === 'small_live' ? 'small_live' : 'paper';
  const liveEnabled = env.ENABLE_LIVE_TRADING === 'true';
  const canPlaceLiveOrders = mode === 'small_live' && liveEnabled;

  if (mode === 'small_live') {
    return {
      mode,
      liveEnabled,
      canPlaceLiveOrders,
      accumulator: SMALL_LIVE_ACCUMULATOR,
      equalizer: SMALL_LIVE_EQUALIZER,
      risk: SMALL_LIVE_RISK,
    };
  }

  return {
    mode,
    liveEnabled,
    canPlaceLiveOrders: false,
    accumulator: PAPER_ACCUMULATOR,
    equalizer: PAPER_EQUALIZER,
    risk: PAPER_RISK,
  };
}
