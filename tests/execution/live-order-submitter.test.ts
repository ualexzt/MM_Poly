import { LiveOrderSubmitter } from '../../src/execution/live-order-submitter';
import { QuoteCandidate } from '../../src/types/quote';

function makeMockClient() {
  return {
    createAndPostOrder: jest.fn(),
    cancelOrder: jest.fn(),
    getOpenOrders: jest.fn(),
  };
}

describe('live-order-submitter', () => {
  test('submits post-only GTC order and returns order result', async () => {
    const mockClient = makeMockClient();
    mockClient.createAndPostOrder.mockResolvedValue({ orderID: 'live-abc-123' });

    const submitter = new LiveOrderSubmitter(mockClient as any);

    const quote: QuoteCandidate = {
      conditionId: 'cond-1',
      tokenId: 'token-yes',
      side: 'BUY',
      price: 0.48,
      size: 10,
      sizeUsd: 4.8,
      orderType: 'GTC',
      postOnly: true,
      fairPrice: 0.49,
      targetHalfSpreadCents: 1,
      inventorySkewCents: 0,
      toxicityScore: 0.1,
      reason: 'test',
      riskFlags: [],
    };

    const result = await submitter.submit(quote, { tickSize: 0.01, negRisk: false });

    expect(result).toEqual({ orderID: 'live-abc-123' });
    expect(mockClient.createAndPostOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenID: 'token-yes',
        side: 'BUY',
        price: '0.48',
        size: '10',
      }),
      expect.objectContaining({ tickSize: '0.01', negRisk: false }),
      'GTC',
      true
    );
  });

  test('throws on submit failure', async () => {
    const mockClient = makeMockClient();
    mockClient.createAndPostOrder.mockRejectedValue(new Error('rate limited'));

    const submitter = new LiveOrderSubmitter(mockClient as any);

    await expect(
      submitter.submit({ tokenId: 't', side: 'BUY', price: 0.5, size: 1 } as any, { tickSize: 0.01, negRisk: false })
    ).rejects.toThrow('rate limited');
  });

  test('cancels order by id', async () => {
    const mockClient = makeMockClient();
    mockClient.cancelOrder.mockResolvedValue({ success: true });

    const submitter = new LiveOrderSubmitter(mockClient as any);
    await submitter.cancel('live-abc-123');

    expect(mockClient.cancelOrder).toHaveBeenCalledWith('live-abc-123');
  });

  test('returns open orders', async () => {
    const mockClient = makeMockClient();
    const open = [{ id: 'o1', tokenId: 't1', side: 'BUY', price: 0.5, size: 10 }];
    mockClient.getOpenOrders.mockResolvedValue(open);

    const submitter = new LiveOrderSubmitter(mockClient as any);
    const result = await submitter.getOpenOrders();

    expect(result).toEqual(open);
  });

  test('propagates open order listing failures', async () => {
    const mockClient = makeMockClient();
    mockClient.getOpenOrders.mockRejectedValue(new Error('network down'));

    const submitter = new LiveOrderSubmitter(mockClient as any);

    await expect(submitter.getOpenOrders()).rejects.toThrow('network down');
  });
});
