/**
 * Reward Accounting — §14
 * Tracks estimated liquidity rewards earned per market.
 */

export interface RewardLedgerEntry {
  timestampMs: number;
  conditionId: string;
  estimatedReward: number;
  rewardPoolUsd: number;
  quoteSizeUsd: number;
}

export class RewardAccounting {
  private entries: RewardLedgerEntry[] = [];
  private totalEstimatedReward = 0;

  recordQuotingPeriod(
    conditionId: string,
    estimatedReward: number,
    rewardPoolUsd: number,
    quoteSizeUsd: number
  ): void {
    this.totalEstimatedReward += estimatedReward;
    this.entries.push({
      timestampMs: Date.now(),
      conditionId,
      estimatedReward,
      rewardPoolUsd,
      quoteSizeUsd,
    });
  }

  getTotalEstimatedReward(): number {
    return this.totalEstimatedReward;
  }

  getRewardSince(sinceMs: number): number {
    return this.entries
      .filter(e => e.timestampMs >= sinceMs)
      .reduce((s, e) => s + e.estimatedReward, 0);
  }

  getEntries(): RewardLedgerEntry[] {
    return [...this.entries];
  }

  reset(): void {
    this.entries = [];
    this.totalEstimatedReward = 0;
  }
}
