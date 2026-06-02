export interface TrackedPosition {
  yesQty: number;
  noQty: number;
  avgYesPrice: number;
  avgNoPrice: number;
  totalYesCostUsd: number;
  totalNoCostUsd: number;
}

export class PositionTracker {
  private positions = new Map<string, TrackedPosition>();

  getPositions(): Map<string, TrackedPosition> {
    return this.positions;
  }

  getPosition(marketId: string): TrackedPosition | null {
    return this.positions.get(marketId) ?? null;
  }

  updateFill(marketId: string, side: 'YES' | 'NO', price: number, qty: number): void {
    const existing = this.positions.get(marketId) ?? {
      yesQty: 0, noQty: 0, avgYesPrice: 0, avgNoPrice: 0, totalYesCostUsd: 0, totalNoCostUsd: 0,
    };

    if (side === 'YES') {
      const newTotalCost = existing.totalYesCostUsd + price * qty;
      const newQty = existing.yesQty + qty;
      existing.avgYesPrice = newQty > 0 ? newTotalCost / newQty : 0;
      existing.yesQty = newQty;
      existing.totalYesCostUsd = newTotalCost;
    } else {
      const newTotalCost = existing.totalNoCostUsd + price * qty;
      const newQty = existing.noQty + qty;
      existing.avgNoPrice = newQty > 0 ? newTotalCost / newQty : 0;
      existing.noQty = newQty;
      existing.totalNoCostUsd = newTotalCost;
    }

    this.positions.set(marketId, existing);
  }

  getAvgPairCost(marketId: string): number | null {
    const pos = this.positions.get(marketId);
    if (!pos || pos.yesQty === 0 || pos.noQty === 0) return null;
    return pos.avgYesPrice + pos.avgNoPrice;
  }

  getTotalExposureUsd(): number {
    let total = 0;
    for (const pos of this.positions.values()) {
      total += pos.totalYesCostUsd + pos.totalNoCostUsd;
    }
    return total;
  }
}
