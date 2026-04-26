import { InventoryState } from '../types/inventory';

export interface ExposureLimitConfig {
  maxMarketExposureUsd: number;
  maxEventExposureUsd: number;
  maxTotalStrategyExposureUsd: number;
  softLimitPct: number;
  hardLimitPct: number;
}

export interface RiskCheckResult {
  allowed: boolean;
  reason?: string;
}

export function checkExposureLimits(inventory: InventoryState, config: ExposureLimitConfig): RiskCheckResult {
  if (inventory.hardLimitBreached) {
    return { allowed: false, reason: 'hard_limit_breached' };
  }
  if (inventory.marketExposureUsd > config.maxMarketExposureUsd) {
    return { allowed: false, reason: 'market_exposure_exceeded' };
  }
  if (inventory.eventExposureUsd > config.maxEventExposureUsd) {
    return { allowed: false, reason: 'event_exposure_exceeded' };
  }
  if (inventory.strategyExposureUsd > config.maxTotalStrategyExposureUsd) {
    return { allowed: false, reason: 'strategy_exposure_exceeded' };
  }
  return { allowed: true };
}
