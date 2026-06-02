import { PolymarketLiveOrderClient } from '../../src/execution/polymarket-live-order-client';

describe('PolymarketLiveOrderClient', () => {
  it('creates post-only BUY order through injected client', async () => {
    const clob = {
      createOrder: jest.fn().mockResolvedValue({ id: 'order-1' }),
      cancelOrder: jest.fn(),
      getOpenOrders: jest.fn(),
    };
    const client = new PolymarketLiveOrderClient(clob as any);

    const result = await client.createOrder({ tokenId: 'token-1', side: 'BUY', price: 0.42, size: 1 });

    expect(result).toEqual({ orderId: 'order-1', status: 'LIVE' });
    expect(clob.createOrder).toHaveBeenCalledWith(expect.objectContaining({
      tokenID: 'token-1',
      side: 'BUY',
      price: 0.42,
      size: 1,
      postOnly: true,
    }));
  });

  it('normalizes create order errors', async () => {
    const clob = {
      createOrder: jest.fn().mockRejectedValue(new Error('bad order')),
      cancelOrder: jest.fn(),
      getOpenOrders: jest.fn(),
    };
    const client = new PolymarketLiveOrderClient(clob as any);

    const result = await client.createOrder({ tokenId: 'token-1', side: 'BUY', price: 0.42, size: 1 });

    expect(result.status).toBe('ERROR');
    expect(result.error).toContain('bad order');
  });
});
