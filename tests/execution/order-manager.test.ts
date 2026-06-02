import {
  OrderManager,
  ClobOrderClient,
  OrderResult,
} from '../../src/execution/order-manager';

function makeMockClient(overrides: Partial<ClobOrderClient> = {}): ClobOrderClient {
  return {
    createOrder: jest.fn().mockResolvedValue({ orderId: 'order-1', status: 'LIVE' }),
    cancelOrder: jest.fn().mockResolvedValue(undefined),
    getOpenOrders: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('OrderManager', () => {
  describe('placeLimitOrder', () => {
    it('creates a limit order via CLOB client', async () => {
      const client = makeMockClient();
      const manager = new OrderManager(client);

      const result = await manager.placeLimitOrder({
        tokenId: 'yes-token-1',
        side: 'BUY',
        price: 0.45,
        size: 10,
      });

      expect(result.orderId).toBe('order-1');
      expect(result.status).toBe('LIVE');
      expect(client.createOrder).toHaveBeenCalledWith(expect.objectContaining({
        tokenId: 'yes-token-1',
        side: 'BUY',
        price: 0.45,
        size: 10,
      }));
    });

    it('returns error when CLOB client throws', async () => {
      const client = makeMockClient({
        createOrder: jest.fn().mockRejectedValue(new Error('insufficient balance')),
      });
      const manager = new OrderManager(client);

      const result = await manager.placeLimitOrder({
        tokenId: 'yes-token-1',
        side: 'BUY',
        price: 0.45,
        size: 10,
      });

      expect(result.orderId).toBeNull();
      expect(result.status).toBe('ERROR');
      expect(result.error).toBe('insufficient balance');
    });
  });

  describe('cancelStaleOrders', () => {
    it('cancels orders older than lifetime', async () => {
      const client = makeMockClient({
        getOpenOrders: jest.fn().mockResolvedValue([
          { orderId: 'order-1', tokenId: 'yes-1', createdAt: Date.now() - 120_000 },
          { orderId: 'order-2', tokenId: 'no-1', createdAt: Date.now() - 10_000 },
        ]),
      });
      const manager = new OrderManager(client);

      const cancelled = await manager.cancelStaleOrders(60_000);

      expect(cancelled).toEqual(['order-1']);
      expect(client.cancelOrder).toHaveBeenCalledWith('order-1');
      expect(client.cancelOrder).not.toHaveBeenCalledWith('order-2');
    });

    it('returns empty when no stale orders', async () => {
      const client = makeMockClient({
        getOpenOrders: jest.fn().mockResolvedValue([
          { orderId: 'order-1', tokenId: 'yes-1', createdAt: Date.now() - 10_000 },
        ]),
      });
      const manager = new OrderManager(client);

      const cancelled = await manager.cancelStaleOrders(60_000);

      expect(cancelled).toEqual([]);
      expect(client.cancelOrder).not.toHaveBeenCalled();
    });
  });

  describe('getOpenOrders', () => {
    it('returns open orders from client', async () => {
      const orders = [
        { orderId: 'order-1', tokenId: 'yes-1', createdAt: Date.now() },
      ];
      const client = makeMockClient({
        getOpenOrders: jest.fn().mockResolvedValue(orders),
      });
      const manager = new OrderManager(client);

      const result = await manager.getOpenOrders();
      expect(result).toEqual(orders);
    });
  });
});
