/**
 * Rebate Accounting — §14
 * Tracks cumulative estimated maker rebates.
 * Note: rebates are estimated until confirmed by actual payout data (§24, point 8).
 */

export interface RebateLedgerEntry {
  timestampMs: number;
  tokenId: string;
  fillSizeUsd: number;
  estimatedRebate: number;
  makerRebateRate: number;
}

export class RebateAccounting {
  private entries: RebateLedgerEntry[] = [];
  private totalEstimatedRebate = 0;

  recordFill(tokenId: string, fillSizeUsd: number, makerRebateRate: number): void {
    const estimated = fillSizeUsd * makerRebateRate;
    this.totalEstimatedRebate += estimated;
    this.entries.push({
      timestampMs: Date.now(),
      tokenId,
      fillSizeUsd,
      estimatedRebate: estimated,
      makerRebateRate,
    });
  }

  getTotalEstimatedRebate(): number {
    return this.totalEstimatedRebate;
  }

  /** Estimated rebate since a given timestamp */
  getRebateSince(sinceMs: number): number {
    return this.entries
      .filter(e => e.timestampMs >= sinceMs)
      .reduce((s, e) => s + e.estimatedRebate, 0);
  }

  getEntries(): RebateLedgerEntry[] {
    return [...this.entries];
  }

  reset(): void {
    this.entries = [];
    this.totalEstimatedRebate = 0;
  }
}
