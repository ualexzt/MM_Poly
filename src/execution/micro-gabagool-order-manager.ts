export interface Order {
  id: string;
  marketId: string;
  tokenId: string;
  side: 'BUY' | 'SELL';
  price: number;
  sizeUsd: number;
  shares: number;
  status: 'PENDING' | 'OPEN' | 'FILLED' | 'PARTIALLY_FILLED' | 'CANCELLED' | 'EXPIRED';
  createdAt: number;
  filledSizeUsd: number;
  filledShares: number;
  isPostOnly: boolean;
}

export interface PlaceOrderParams {
  marketId: string;
  tokenId: string;
  side: 'BUY' | 'SELL';
  price: number;
  sizeUsd: number;
  isPostOnly: boolean;
}

export interface OrderManagerDeps {
  placeOrder: (params: PlaceOrderParams) => Promise<{ orderId: string }>;
  cancelOrder: (orderId: string) => Promise<boolean>;
  getOrderStatus: (orderId: string) => Promise<{ status: string; filledSizeUsd: number }>;
  nowMs: () => number;
}

export class MicroGabagoolOrderManager {
  private orders: Map<string, Order> = new Map();
  private orderCounter: number = 0;

  constructor(private deps: OrderManagerDeps) {}

  async placeEntry(params: PlaceOrderParams): Promise<Order> {
    const localId = `local-${++this.orderCounter}`;
    const shares = params.sizeUsd / params.price;

    const order: Order = {
      id: localId,
      marketId: params.marketId,
      tokenId: params.tokenId,
      side: params.side,
      price: params.price,
      sizeUsd: params.sizeUsd,
      shares,
      status: 'PENDING',
      createdAt: this.deps.nowMs(),
      filledSizeUsd: 0,
      filledShares: 0,
      isPostOnly: params.isPostOnly,
    };

    this.orders.set(localId, order);

    try {
      const result = await this.deps.placeOrder(params);
      order.status = 'OPEN';
      order.id = result.orderId;
      this.orders.set(result.orderId, order);
      this.orders.delete(localId);
      return order;
    } catch (error) {
      order.status = 'CANCELLED';
      throw error;
    }
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    const order = this.orders.get(orderId);
    if (!order) return false;

    const success = await this.deps.cancelOrder(orderId);
    if (success) {
      order.status = 'CANCELLED';
    }
    return success;
  }

  async checkOrderTimeouts(maxAgeSeconds: number): Promise<Order[]> {
    const now = this.deps.nowMs();
    const timedOut: Order[] = [];

    for (const order of this.orders.values()) {
      if (order.status !== 'OPEN') continue;

      const ageSeconds = (now - order.createdAt) / 1000;
      if (ageSeconds > maxAgeSeconds) {
        order.status = 'EXPIRED';
        timedOut.push(order);
      }
    }

    return timedOut;
  }

  async reconcileOrder(orderId: string): Promise<Order | null> {
    const order = this.orders.get(orderId);
    if (!order) return null;

    const status = await this.deps.getOrderStatus(orderId);
    order.status = status.status as Order['status'];
    order.filledSizeUsd = status.filledSizeUsd;
    order.filledShares = status.filledSizeUsd / order.price;

    return order;
  }

  getOrder(orderId: string): Order | undefined {
    return this.orders.get(orderId);
  }

  getOpenOrders(): Order[] {
    return Array.from(this.orders.values()).filter(o => o.status === 'OPEN');
  }

  getOpenOrdersForMarket(marketId: string): Order[] {
    return Array.from(this.orders.values()).filter(
      o => o.marketId === marketId && o.status === 'OPEN'
    );
  }

  hasOpenOrderForMarket(marketId: string): boolean {
    return this.getOpenOrdersForMarket(marketId).length > 0;
  }

  getAllOrders(): Order[] {
    return Array.from(this.orders.values());
  }
}
