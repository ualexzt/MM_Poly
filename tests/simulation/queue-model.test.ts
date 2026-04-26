import { estimateQueuePosition } from '../../src/simulation/queue-model';

describe('queue-model', () => {
  test('returns behind_existing_size by default', () => {
    const pos = estimateQueuePosition(0.45, 'BUY', {
      bids: [{ price: 0.45, size: 100, sizeUsd: 45 }],
      asks: []
    } as any);
    expect(pos).toBe('behind_existing_size');
  });
});
