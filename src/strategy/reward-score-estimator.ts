import { MarketState } from '../types/market';
import { BookState } from '../types/book';

/**
 * Reward Score Estimator — §5.1 (reward_potential_score), §14
 * Estimates expected liquidity reward PnL for a given market.
 */

/**
 * Estimates the expected daily reward for quoting a market.
 * Score based on reward pool, spread competitiveness, and quote size (§5.1).
 */
export function estimateDailyReward(
  market: MarketState,
  book: BookState,
  quoteSizeUsd: number
): number {
  const cfg = market.rewardConfig;
  if (!cfg?.enabled || !cfg.rewardPoolUsd) return 0;

  // Our quote must be within maxIncentiveSpreadCents
  const halfSpreadCents = (book.spread ?? 0) * 50; // book half-spread in cents
  if (halfSpreadCents > cfg.maxIncentiveSpreadCents) return 0;

  // Our quote size must meet minIncentiveSizeUsd
  if (quoteSizeUsd < cfg.minIncentiveSizeUsd) return 0;

  // Rough share of reward pool: our size / total incentivised liquidity
  // We estimate total pool / expected competing size ~ 10x our size
  const competitionFactor = 0.1;
  return cfg.rewardPoolUsd * competitionFactor;
}

/**
 * Reward potential score [0,1] normalised against a reference daily pool (§5.1).
 */
export function rewardPotentialScore(market: MarketState): number {
  const cfg = market.rewardConfig;
  if (!cfg?.enabled || !cfg.rewardPoolUsd) return 0;
  const maxPool = 10_000;
  return Math.min(cfg.rewardPoolUsd / maxPool, 1.0);
}
