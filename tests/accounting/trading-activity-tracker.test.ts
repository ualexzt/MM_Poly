import { TradingActivityTracker } from '../../src/accounting/trading-activity-tracker';
import { FillEvent } from '../../src/simulation/paper-execution-engine';

describe('TradingActivityTracker', () => {
  const buyFill: FillEvent = {
    orderId: 'order-1',
    tokenId: 'token-yes',
    side: 'BUY',
    filledPrice: 0.54,
    filledSize: 2,
    remainingSize: 0,
  };

  const sellFill: FillEvent = {
    orderId: 'order-2',
    tokenId: 'token-yes',
    side: 'SELL',
    filledPrice: 0.62,
    filledSize: 3,
    remainingSize: 0,
  };

  test('counts fills, contracts, notional, and average fill price', () => {
    const tracker = new TradingActivityTracker();

    tracker.recordFill('market-1', buyFill);
    tracker.recordFill('market-1', sellFill);

    const snapshot = tracker.snapshot();

    expect(snapshot.fillsTotal).toBe(2);
    expect(snapshot.buyFills).toBe(1);
    expect(snapshot.sellFills).toBe(1);
    expect(snapshot.buyContracts).toBe(2);
    expect(snapshot.sellContracts).toBe(3);
    expect(snapshot.totalContracts).toBe(5);
    expect(snapshot.buyNotional).toBeCloseTo(1.08);
    expect(snapshot.sellNotional).toBeCloseTo(1.86);
    expect(snapshot.notionalVolume).toBeCloseTo(2.94);
    expect(snapshot.avgFillPrice).toBeCloseTo(2.94 / 5);
    expect(snapshot.activeMarkets).toBe(1);
  });

  test('counts quote traces and primary market concentration', () => {
    const tracker = new TradingActivityTracker();

    tracker.recordQuoteGenerated('market-1');
    tracker.recordQuoteGenerated('market-1');
    tracker.recordQuoteGenerated('market-2');
    tracker.recordQuoteRejected('market-1');

    const snapshot = tracker.snapshot();

    expect(snapshot.quoteTraces).toBe(4);
    expect(snapshot.quoteGeneratedCount).toBe(3);
    expect(snapshot.quoteRejectedCount).toBe(1);
    expect(snapshot.activeMarkets).toBe(2);
    expect(snapshot.primaryMarketConditionId).toBe('market-1');
    expect(snapshot.primaryMarketQuoteTraces).toBe(3);
    expect(snapshot.primaryMarketQuoteSharePct).toBeCloseTo(75);
  });

  test('returns null averages and primary market when empty', () => {
    const tracker = new TradingActivityTracker();

    const snapshot = tracker.snapshot();

    expect(snapshot.fillsTotal).toBe(0);
    expect(snapshot.avgFillPrice).toBeNull();
    expect(snapshot.primaryMarketConditionId).toBeNull();
    expect(snapshot.primaryMarketQuoteSharePct).toBeNull();
  });
});
