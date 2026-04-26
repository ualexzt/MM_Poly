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

export class PaperExecutionEngine {
  private orders: Map<string, PaperOrder> = new Map();
  private filledSizes: Map<string, number> = new Map();

  submit(order: PaperOrder): void {
    this.orders.set(order.id, order);
    this.filledSizes.set(order.id, 0);
  }

  cancel(orderId: string): void {
    this.orders.delete(orderId);
    this.filledSizes.delete(orderId);
  }

  cancelByTokenId(tokenId: string): void {
    for (const [id, order] of this.orders) {
      if (order.tokenId === tokenId) {
        this.orders.delete(id);
        this.filledSizes.delete(id);
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
        const fillSize = Math.min(remaining, trade.size);
        this.filledSizes.set(orderId, alreadyFilled + fillSize);
        fills.push({
          orderId, tokenId: order.tokenId, side: order.side,
          filledPrice: trade.price, filledSize: fillSize, remainingSize: remaining - fillSize
        });
      }
    }
    return fills;
  }

  getOpenOrders(): PaperOrder[] {
    return Array.from(this.orders.values());
  }
}
