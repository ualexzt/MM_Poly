import { PolymarketLiveOrderClient } from '../../src/execution/polymarket-live-order-client';

describe('PolymarketLiveOrderClient', () => {
  it('posts post-only GTC BUY order through injected client', async () => {
    const clob = {
      createAndPostOrder: jest.fn().mockResolvedValue({ orderID: 'order-1' }),
      cancelOrder: jest.fn(),
      getOpenOrders: jest.fn(),
    };
    const client = new PolymarketLiveOrderClient(clob as any);

    const result = await client.createOrder({ tokenId: 'token-1', side: 'BUY', price: 0.42, size: 1 });

    expect(result).toEqual({ orderId: 'order-1', status: 'LIVE' });
    expect(clob.createAndPostOrder).toHaveBeenCalledWith(expect.objectContaining({
      tokenID: 'token-1',
      side: 'BUY',
      price: 0.42,
      size: 1,
    }), undefined, 'GTC', true);
  });

  it('normalizes create order errors', async () => {
    const clob = {
      createAndPostOrder: jest.fn().mockRejectedValue(new Error('bad order')),
      cancelOrder: jest.fn(),
      getOpenOrders: jest.fn(),
    };
    const client = new PolymarketLiveOrderClient(clob as any);

    const result = await client.createOrder({ tokenId: 'token-1', side: 'BUY', price: 0.42, size: 1 });

    expect(result.status).toBe('ERROR');
    expect(result.error).toContain('bad order');
  });

  it('cancels orders with CLOB orderID payload', async () => {
    const clob = {
      createAndPostOrder: jest.fn(),
      cancelOrder: jest.fn().mockResolvedValue({}),
      getOpenOrders: jest.fn(),
    };
    const client = new PolymarketLiveOrderClient(clob as any);

    await client.cancelOrder('order-1');

    expect(clob.cancelOrder).toHaveBeenCalledWith({ orderID: 'order-1' });
  });

  it('maps CLOB open orders to internal open order shape', async () => {
    const clob = {
      createAndPostOrder: jest.fn(),
      cancelOrder: jest.fn(),
      getOpenOrders: jest.fn().mockResolvedValue([
        { id: 'order-1', asset_id: 'token-1', created_at: 123 },
      ]),
    };
    const client = new PolymarketLiveOrderClient(clob as any);

    await expect(client.getOpenOrders()).resolves.toEqual([
      { orderId: 'order-1', tokenId: 'token-1', createdAt: 123 },
    ]);
  });
});
