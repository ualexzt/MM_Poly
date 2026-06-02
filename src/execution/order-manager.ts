export interface ClobOrderClient {
  createOrder(params: { tokenId: string; side: string; price: number; size: number }): Promise<OrderResult>;
  cancelOrder(orderId: string): Promise<void>;
  getOpenOrders(): Promise<OpenOrder[]>;
}

export interface OrderResult {
  orderId: string | null;
  status: 'LIVE' | 'ERROR';
  error?: string;
}

export interface OpenOrder {
  orderId: string;
  tokenId: string;
  createdAt: number;
}

export interface PlaceOrderParams {
  tokenId: string;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
}

export class OrderManager {
  constructor(private client: ClobOrderClient) {}

  async placeLimitOrder(params: PlaceOrderParams): Promise<OrderResult> {
    try {
      return await this.client.createOrder(params);
    } catch (err) {
      return { orderId: null, status: 'ERROR', error: (err as Error).message };
    }
  }

  async cancelStaleOrders(lifetimeMs: number): Promise<string[]> {
    const now = Date.now();
    const orders = await this.client.getOpenOrders();
    const stale = orders.filter(o => now - o.createdAt > lifetimeMs);
    const cancelled: string[] = [];

    for (const order of stale) {
      try {
        await this.client.cancelOrder(order.orderId);
        cancelled.push(order.orderId);
      } catch {
        // best-effort cancel
      }
    }

    return cancelled;
  }

  async getOpenOrders(): Promise<OpenOrder[]> {
    return this.client.getOpenOrders();
  }
}
