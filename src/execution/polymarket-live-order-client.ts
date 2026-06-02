import { ClobOrderClient, OpenOrder, OrderResult } from './order-manager';

export interface MinimalPolymarketClobClient {
  createAndPostOrder(
    userOrder: Record<string, unknown>,
    options: undefined,
    orderType: 'GTC',
    postOnly: true,
  ): Promise<{ id?: string; orderId?: string; orderID?: string; success?: boolean; errorMsg?: string; status?: string }>;
  cancelOrder(payload: { orderID: string }): Promise<void>;
  getOpenOrders(): Promise<Array<{
    id?: string;
    orderId?: string;
    orderID?: string;
    tokenID?: string;
    tokenId?: string;
    asset_id?: string;
    createdAt?: number;
    created_at?: number;
  }>>;
}

export class PolymarketLiveOrderClient implements ClobOrderClient {
  constructor(private clob: MinimalPolymarketClobClient) {}

  async createOrder(params: { tokenId: string; side: string; price: number; size: number }): Promise<OrderResult> {
    try {
      const order = await this.clob.createAndPostOrder({
        tokenID: params.tokenId,
        side: params.side,
        price: params.price,
        size: params.size,
      }, undefined, 'GTC', true);
      if (order.success === false) {
        return { orderId: null, status: 'ERROR', error: order.errorMsg || order.status || 'CLOB rejected order' };
      }

      const orderId = order.id ?? order.orderId ?? order.orderID ?? null;
      if (!orderId) {
        return { orderId: null, status: 'ERROR', error: `CLOB response missing order id: ${JSON.stringify(order)}` };
      }

      return { orderId, status: 'LIVE' };
    } catch (err) {
      return { orderId: null, status: 'ERROR', error: (err as Error).message };
    }
  }

  async cancelOrder(orderId: string): Promise<void> {
    await this.clob.cancelOrder({ orderID: orderId });
  }

  async getOpenOrders(): Promise<OpenOrder[]> {
    const orders = await this.clob.getOpenOrders();
    return orders.map((o) => ({
      orderId: o.id ?? o.orderId ?? o.orderID ?? '',
      tokenId: o.tokenID ?? o.tokenId ?? o.asset_id ?? '',
      createdAt: o.createdAt ?? o.created_at ?? Date.now(),
    })).filter((o) => o.orderId.length > 0);
  }
}
