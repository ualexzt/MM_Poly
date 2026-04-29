import { MarketState } from '../types/market';
import { BookState } from '../types/book';

/**
 * Rebate Estimator — §5.1 (rebate_potential_score), §14
 * Estimates expected maker rebate PnL for a given market.
 */

/**
 * Estimates the expected maker rebate from passive fills.
 * @param fillSizeUsd - filled notional in USD
 * @param makerRebateRate - rebate rate (e.g. 0.001 = 0.1%)
 */
export function estimateMakerRebate(fillSizeUsd: number, makerRebateRate: number): number {
  return fillSizeUsd * makerRebateRate;
}

/**
 * Estimates hourly rebate potential for a market based on volume and fee config.
 * Formula hint from §5.1: fee_rate * midpoint * (1 - midpoint) * estimated_flow
 */
export function estimateHourlyRebatePotential(
  market: MarketState,
  book: BookState
): number {
  const feeRate = market.makerRebateRate ?? market.feeRate ?? 0.001;
  const mid = book.midpoint ?? 0.5;
  const hourlyFlow = market.volume24hUsd / 24;
  return feeRate * mid * (1 - mid) * hourlyFlow;
}

/**
 * Estimates rebate for a batch of fills.
 */
export function estimateRebateForFills(
  fills: Array<{ sizeUsd: number }>,
  makerRebateRate: number
): number {
  return fills.reduce((sum, f) => sum + f.sizeUsd * makerRebateRate, 0);
}
