export interface PaperEngineConfig {
  gasPerRoundtripEstimateUsd: number;
  makerRebateRate: number;
  fillProbability: number;
  partialFillProbability: number;
  lateFillProbability: number;
}

export interface SimulatedFill {
  orderId: string;
  filledSizeUsd: number;
  filledShares: number;
  isPartial: boolean;
  isLateFill: boolean;
}

export class MicroGabagoolPaperEngine {
  private pendingCancels: Map<string, { cancelledAt: number; originalOrder: { price: number; sizeUsd: number } }> = new Map();

  constructor(
    private config: PaperEngineConfig,
    private nowFn: () => number = Date.now
  ) {}

  simulateFill(orderId: string, price: number, sizeUsd: number, orderbook: { bestBid: number; bestAsk: number }): SimulatedFill | null {
    // Post-only check: if price would cross, no fill
    if (price >= orderbook.bestAsk) {
      return null; // Would be taker, reject
    }

    // Random fill probability
    if (Math.random() > this.config.fillProbability) {
      return null;
    }

    // Partial fill probability
    const isPartial = Math.random() < this.config.partialFillProbability;
    const filledSizeUsd = isPartial ? sizeUsd * (0.3 + Math.random() * 0.7) : sizeUsd;
    const filledShares = filledSizeUsd / price;

    return {
      orderId,
      filledSizeUsd,
      filledShares,
      isPartial,
      isLateFill: false,
    };
  }

  simulateLateFill(orderId: string, price: number, sizeUsd: number): SimulatedFill | null {
    const pending = this.pendingCancels.get(orderId);
    if (!pending) return null;

    // Small chance of late fill
    if (Math.random() > this.config.lateFillProbability) {
      this.pendingCancels.delete(orderId);
      return null;
    }

    this.pendingCancels.delete(orderId);

    return {
      orderId,
      filledSizeUsd: sizeUsd,
      filledShares: sizeUsd / price,
      isPartial: false,
      isLateFill: true,
    };
  }

  recordCancel(orderId: string, order: { price: number; sizeUsd: number }): void {
    this.pendingCancels.set(orderId, {
      cancelledAt: this.nowFn(),
      originalOrder: order,
    });
  }

  simulateGasCost(): number {
    return this.config.gasPerRoundtripEstimateUsd;
  }

  simulateMakerRebate(sizeUsd: number): number {
    return sizeUsd * this.config.makerRebateRate;
  }
}
