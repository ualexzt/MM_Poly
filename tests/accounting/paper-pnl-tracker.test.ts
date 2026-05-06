import { PaperPnlTracker } from '../../src/accounting/paper-pnl-tracker';

describe('PaperPnlTracker cumulative totals', () => {
  test('exposes cumulative realized pnl across all positions', () => {
    const tracker = new PaperPnlTracker();

    tracker.onFill({ orderId: 'buy-1', tokenId: 'token-1', side: 'BUY', filledPrice: 0.50, filledSize: 10, remainingSize: 0 }, 0.50);
    tracker.onFill({ orderId: 'sell-1', tokenId: 'token-1', side: 'SELL', filledPrice: 0.60, filledSize: 4, remainingSize: 0 }, 0.60);

    expect(tracker.getCumulativeRealizedPnl()).toBeCloseTo(0.40);
  });

  test('exposes open position count', () => {
    const tracker = new PaperPnlTracker();

    tracker.onFill({ orderId: 'buy-1', tokenId: 'token-1', side: 'BUY', filledPrice: 0.50, filledSize: 10, remainingSize: 0 }, 0.50);
    tracker.onFill({ orderId: 'buy-2', tokenId: 'token-2', side: 'BUY', filledPrice: 0.30, filledSize: 5, remainingSize: 0 }, 0.30);
    tracker.onFill({ orderId: 'sell-1', tokenId: 'token-2', side: 'SELL', filledPrice: 0.31, filledSize: 5, remainingSize: 0 }, 0.31);

    expect(tracker.getOpenPositionCount()).toBe(1);
  });
});
