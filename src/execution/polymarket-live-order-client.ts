import { ClobOrderClient, OpenOrder, OrderResult } from './order-manager';

export interface MinimalPolymarketClobClient {
  createOrder(params: Record<string, unknown>): Promise<{ id?: string; orderId?: string }>;
  cancelOrder(orderId: string): Promise<void>;
  getOpenOrders(): Promise<Array<{ id?: string; orderId?: string; tokenID?: string; tokenId?: string; createdAt?: number }>>;
}

export class PolymarketLiveOrderClient implements ClobOrderClient {
  constructor(private clob: MinimalPolymarketClobClient) {}

  async createOrder(params: { tokenId: string; side: string; price: number; size: number }): Promise<OrderResult> {
    try {
      const order = await this.clob.createOrder({
        tokenID: params.tokenId,
        side: params.side,
        price: params.price,
        size: params.size,
        postOnly: true,
      });
      return { orderId: order.id ?? order.orderId ?? null, status: 'LIVE' };
    } catch (err) {
      return { orderId: null, status: 'ERROR', error: (err as Error).message };
    }
  }

  async cancelOrder(orderId: string): Promise<void> {
    await this.clob.cancelOrder(orderId);
  }

  async getOpenOrders(): Promise<OpenOrder[]> {
    const orders = await this.clob.getOpenOrders();
    return orders.map((o) => ({
      orderId: o.id ?? o.orderId ?? '',
      tokenId: o.tokenID ?? o.tokenId ?? '',
      createdAt: o.createdAt ?? Date.now(),
    })).filter((o) => o.orderId.length > 0);
  }
}
