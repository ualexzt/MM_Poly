export interface PaperOrder {
  id: string;
  tokenId: string;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  sizeUsd: number;
  postOnly: true;
}

export interface TradeEvent {
  tokenId: string;
  price: number;
  size: number;
}

export interface FillEvent {
  orderId: string;
  tokenId: string;
  side: 'BUY' | 'SELL';
  filledPrice: number;
  filledSize: number;
  remainingSize: number;
}

export interface PaperExecutionConfig {
  queueAheadSize: number;
  fillFractionAfterQueue: number;
}

export class PaperExecutionEngine {
  private orders: Map<string, PaperOrder> = new Map();
  private filledSizes: Map<string, number> = new Map();
  private crossedTradeSizes: Map<string, number> = new Map();

  constructor(private config: PaperExecutionConfig | null = null) {}

  submit(order: PaperOrder): void {
    this.orders.set(order.id, order);
    this.filledSizes.set(order.id, 0);
    this.crossedTradeSizes.set(order.id, 0);
  }

  cancel(orderId: string): void {
    this.orders.delete(orderId);
    this.filledSizes.delete(orderId);
    this.crossedTradeSizes.delete(orderId);
  }

  cancelByTokenId(tokenId: string): void {
    for (const [id, order] of this.orders) {
      if (order.tokenId === tokenId) {
        this.orders.delete(id);
        this.filledSizes.delete(id);
        this.crossedTradeSizes.delete(id);
      }
    }
  }

  onTrade(trade: TradeEvent): FillEvent[] {
    const fills: FillEvent[] = [];
    for (const [orderId, order] of this.orders) {
      if (order.tokenId !== trade.tokenId) continue;
      const alreadyFilled = this.filledSizes.get(orderId) || 0;
      const remaining = order.size - alreadyFilled;
      if (remaining <= 0) continue;

      let shouldFill = false;
      if (order.side === 'BUY' && trade.price <= order.price) {
        shouldFill = true;
      } else if (order.side === 'SELL' && trade.price >= order.price) {
        shouldFill = true;
      }

      if (shouldFill) {
        const fillSize = this.computeFillSize(orderId, remaining, trade.size);
        if (fillSize <= 0) continue;

        this.filledSizes.set(orderId, alreadyFilled + fillSize);
        fills.push({
          orderId, tokenId: order.tokenId, side: order.side,
          filledPrice: trade.price, filledSize: fillSize, remainingSize: remaining - fillSize
        });
        if (alreadyFilled + fillSize >= order.size) {
          this.orders.delete(orderId);
          this.filledSizes.delete(orderId);
          this.crossedTradeSizes.delete(orderId);
        }
      }
    }
    return fills;
  }

  getOpenOrders(): PaperOrder[] {
    return Array.from(this.orders.values());
  }

  private computeFillSize(orderId: string, remaining: number, tradeSize: number): number {
    if (!this.config) return Math.min(remaining, tradeSize);

    const previousCrossedSize = this.crossedTradeSizes.get(orderId) ?? 0;
    const totalCrossedSize = previousCrossedSize + tradeSize;
    this.crossedTradeSizes.set(orderId, totalCrossedSize);

    const fillableCrossedSize = Math.max(0, totalCrossedSize - this.config.queueAheadSize);
    const previousFillableCrossedSize = Math.max(0, previousCrossedSize - this.config.queueAheadSize);
    const newlyFillableSize = fillableCrossedSize - previousFillableCrossedSize;
    const conservativeFillSize = newlyFillableSize * this.config.fillFractionAfterQueue;

    return Math.min(remaining, conservativeFillSize);
  }
}
