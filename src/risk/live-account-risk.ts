export type LiveAccountBlocker =
  | 'mode_not_small_live'
  | 'live_trading_disabled'
  | 'max_markets_above_approved_limit'
  | 'max_exposure_above_approved_limit'
  | 'telegram_missing'
  | 'telegram_unhealthy'
  | 'balance_below_min_order'
  | 'open_order_leak'
  | 'active_exposure_above_limit'
  | 'submit_rejects_above_threshold';

export type LiveAccountWarning = 'low_free_balance' | 'positions_present' | 'open_orders_present';

export interface LiveAccountRiskInput {
  mode: 'paper' | 'shadow' | 'small_live' | 'disabled';
  liveTradingEnabled: boolean;
  maxMarkets: number;
  maxExposureUsd: number;
  telegramConfigured: boolean;
  telegramHealthy: boolean;
  collateralBalanceUsd: number;
  openOrderNotionalUsd: number;
  expectedOpenOrderNotionalUsd: number;
  positionsValueUsd: number;
  minRequiredOrderUsd: number;
  submitRejectsLastWindow: number;
}

export interface LiveAccountRiskResult {
  ok: boolean;
  blockers: LiveAccountBlocker[];
  warnings: LiveAccountWarning[];
  freeCollateralUsd: number;
  activeExposureUsd: number;
}

const APPROVED_MAX_MARKETS = 2;
const APPROVED_MAX_EXPOSURE_USD = 10;
const OPEN_ORDER_LEAK_TOLERANCE_USD = 0.05;
const SUBMIT_REJECT_LIMIT = 3;

export function evaluateLiveAccountRisk(input: LiveAccountRiskInput): LiveAccountRiskResult {
  const blockers: LiveAccountBlocker[] = [];
  const warnings: LiveAccountWarning[] = [];
  const freeCollateralUsd = input.collateralBalanceUsd - input.openOrderNotionalUsd;
  const activeExposureUsd = input.openOrderNotionalUsd + input.positionsValueUsd;

  if (input.mode !== 'small_live') blockers.push('mode_not_small_live');
  if (!input.liveTradingEnabled) blockers.push('live_trading_disabled');
  if (input.maxMarkets > APPROVED_MAX_MARKETS) blockers.push('max_markets_above_approved_limit');
  if (input.maxExposureUsd > APPROVED_MAX_EXPOSURE_USD) blockers.push('max_exposure_above_approved_limit');
  if (!input.telegramConfigured) blockers.push('telegram_missing');
  if (input.telegramConfigured && !input.telegramHealthy) blockers.push('telegram_unhealthy');
  if (freeCollateralUsd < input.minRequiredOrderUsd) blockers.push('balance_below_min_order');
  if (input.openOrderNotionalUsd - input.expectedOpenOrderNotionalUsd > OPEN_ORDER_LEAK_TOLERANCE_USD) blockers.push('open_order_leak');
  if (activeExposureUsd > input.maxExposureUsd) blockers.push('active_exposure_above_limit');
  if (input.submitRejectsLastWindow >= SUBMIT_REJECT_LIMIT) blockers.push('submit_rejects_above_threshold');

  if (input.positionsValueUsd > 0) warnings.push('positions_present');
  if (input.openOrderNotionalUsd > 0) warnings.push('open_orders_present');
  if (freeCollateralUsd >= input.minRequiredOrderUsd && freeCollateralUsd < input.minRequiredOrderUsd * 2) {
    warnings.push('low_free_balance');
  }

  return { ok: blockers.length === 0, blockers, warnings, freeCollateralUsd, activeExposureUsd };
}
