import { MicroGabagoolOrderManager, OrderManagerDeps } from '../../src/execution/micro-gabagool-order-manager';

function mockDeps(overrides?: Partial<OrderManagerDeps>): OrderManagerDeps {
  return {
    placeOrder: jest.fn().mockResolvedValue({ orderId: 'exchange-1' }),
    cancelOrder: jest.fn().mockResolvedValue(true),
    getOrderStatus: jest.fn().mockResolvedValue({ status: 'OPEN', filledSizeUsd: 0 }),
    nowMs: () => 1000000,
    ...overrides,
  };
}

describe('MicroGabagoolOrderManager', () => {
  it('should place entry order', async () => {
    const deps = mockDeps();
    const om = new MicroGabagoolOrderManager(deps);

    const order = await om.placeEntry({
      marketId: 'm1',
      tokenId: 'token1',
      side: 'BUY',
      price: 0.45,
      sizeUsd: 1.0,
      isPostOnly: true,
    });

    expect(order.status).toBe('OPEN');
    expect(order.price).toBe(0.45);
    expect(order.sizeUsd).toBe(1.0);
    expect(order.isPostOnly).toBe(true);
    expect(deps.placeOrder).toHaveBeenCalled();
  });

  it('should cancel order', async () => {
    const deps = mockDeps();
    const om = new MicroGabagoolOrderManager(deps);

    await om.placeEntry({
      marketId: 'm1',
      tokenId: 'token1',
      side: 'BUY',
      price: 0.45,
      sizeUsd: 1.0,
      isPostOnly: true,
    });

    const success = await om.cancelOrder('exchange-1');
    expect(success).toBe(true);
    expect(om.getOrder('exchange-1')?.status).toBe('CANCELLED');
  });

  it('should detect timed out orders', async () => {
    let currentTime = 1000000;
    const deps = mockDeps({ nowMs: () => currentTime });
    const om = new MicroGabagoolOrderManager(deps);

    await om.placeEntry({
      marketId: 'm1',
      tokenId: 'token1',
      side: 'BUY',
      price: 0.45,
      sizeUsd: 1.0,
      isPostOnly: true,
    });

    currentTime = 1000000 + 46 * 1000; // 46 seconds later
    const timedOut = await om.checkOrderTimeouts(45);
    expect(timedOut).toHaveLength(1);
    expect(timedOut[0].status).toBe('EXPIRED');
  });

  it('should track open orders per market', async () => {
    const deps = mockDeps();
    const om = new MicroGabagoolOrderManager(deps);

    await om.placeEntry({
      marketId: 'm1',
      tokenId: 'token1',
      side: 'BUY',
      price: 0.45,
      sizeUsd: 1.0,
      isPostOnly: true,
    });

    expect(om.hasOpenOrderForMarket('m1')).toBe(true);
    expect(om.hasOpenOrderForMarket('m2')).toBe(false);
    expect(om.getOpenOrdersForMarket('m1')).toHaveLength(1);
  });

  it('should reconcile order status', async () => {
    const deps = mockDeps({
      getOrderStatus: jest.fn().mockResolvedValue({ status: 'FILLED', filledSizeUsd: 1.0 }),
    });
    const om = new MicroGabagoolOrderManager(deps);

    await om.placeEntry({
      marketId: 'm1',
      tokenId: 'token1',
      side: 'BUY',
      price: 0.45,
      sizeUsd: 1.0,
      isPostOnly: true,
    });

    const order = await om.reconcileOrder('exchange-1');
    expect(order).not.toBeNull();
    expect(order!.status).toBe('FILLED');
    expect(order!.filledSizeUsd).toBe(1.0);
  });

  it('should handle place order failure', async () => {
    const deps = mockDeps({
      placeOrder: jest.fn().mockRejectedValue(new Error('API error')),
    });
    const om = new MicroGabagoolOrderManager(deps);

    await expect(
      om.placeEntry({
        marketId: 'm1',
        tokenId: 'token1',
        side: 'BUY',
        price: 0.45,
        sizeUsd: 1.0,
        isPostOnly: true,
      })
    ).rejects.toThrow('API error');

    // The local order should be marked as cancelled
    const orders = om.getAllOrders();
    expect(orders).toHaveLength(1);
    expect(orders[0].status).toBe('CANCELLED');
  });

  it('should return false when cancelling non-existent order', async () => {
    const deps = mockDeps();
    const om = new MicroGabagoolOrderManager(deps);

    const success = await om.cancelOrder('non-existent');
    expect(success).toBe(false);
  });

  it('should return null when reconciling non-existent order', async () => {
    const deps = mockDeps();
    const om = new MicroGabagoolOrderManager(deps);

    const order = await om.reconcileOrder('non-existent');
    expect(order).toBeNull();
  });
});
