import type { RiskStatus } from './strategy-risk-manager';

export type SmallLiveGoNoGoBlocker =
  | 'risk_status_not_ok'
  | 'severe_negative_executable_exit'
  | 'invalid_book_crossed_or_missing'
  | 'top_inventory_exit_worse_than_minus_25c'
  | 'realized_pnl_ex_rebates_not_positive'
  | 'tests_not_passing'
  | 'build_not_passing';

export interface SmallLiveGoNoGoInput {
  riskStatus: RiskStatus;
  reasons: string[];
  realizedPnlExRebatesUsd: number;
  worstTopInventoryExitPnlUsd: number | null;
  testsPassing: boolean;
  buildPassing: boolean;
}

export interface SmallLiveGoNoGoResult {
  go: boolean;
  blockers: SmallLiveGoNoGoBlocker[];
}

export function evaluateSmallLiveGoNoGo(input: SmallLiveGoNoGoInput): SmallLiveGoNoGoResult {
  const blockers: SmallLiveGoNoGoBlocker[] = [];

  if (input.riskStatus !== 'OK') blockers.push('risk_status_not_ok');
  if (input.reasons.includes('severe_negative_executable_exit')) blockers.push('severe_negative_executable_exit');
  if (input.reasons.includes('invalid_book_crossed_or_missing')) blockers.push('invalid_book_crossed_or_missing');
  if (input.worstTopInventoryExitPnlUsd !== null && input.worstTopInventoryExitPnlUsd < -0.25) {
    blockers.push('top_inventory_exit_worse_than_minus_25c');
  }
  if (input.realizedPnlExRebatesUsd <= 0) blockers.push('realized_pnl_ex_rebates_not_positive');
  if (!input.testsPassing) blockers.push('tests_not_passing');
  if (!input.buildPassing) blockers.push('build_not_passing');

  return { go: blockers.length === 0, blockers };
}
