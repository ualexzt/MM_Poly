import { MicroGabagoolPnlTracker, PnlConfig } from '../../src/accounting/micro-gabagool-pnl-tracker';

const defaultConfig: PnlConfig = {
  gasPerRoundtripEstimateUsd: 0.004,
  makerRebateRate: 0.001,
  initialBalanceUsd: 15.0,
};

describe('MicroGabagoolPnlTracker', () => {
  it('should track fill and exit correctly', () => {
    const tracker = new MicroGabagoolPnlTracker(defaultConfig);

    tracker.recordFill('m1', 0.45, 1.0, 1.0 / 0.45);
    expect(tracker.hasPosition('m1')).toBe(true);
    expect(tracker.getBalance()).toBeCloseTo(14.0, 2);

    const trade = tracker.recordExit('m1', 0.46, false, 60);
    expect(trade.grossProfitUsd).toBeCloseTo(0.0222, 3);
    expect(trade.gasCostUsd).toBe(0.004);
    expect(trade.rebateUsd).toBeCloseTo(0.001, 3);
    expect(trade.netProfitUsd).toBeCloseTo(0.0192, 3);
    expect(trade.isTakerExit).toBe(false);
    expect(tracker.hasPosition('m1')).toBe(false);
  });

  it('should track losses correctly', () => {
    const tracker = new MicroGabagoolPnlTracker(defaultConfig);

    tracker.recordFill('m1', 0.45, 1.0, 1.0 / 0.45);
    const trade = tracker.recordExit('m1', 0.44, false, 120);

    expect(trade.grossProfitUsd).toBeLessThan(0);
    expect(trade.netProfitUsd).toBeLessThan(0);
  });

  it('should track taker exits', () => {
    const tracker = new MicroGabagoolPnlTracker(defaultConfig);

    tracker.recordFill('m1', 0.45, 1.0, 1.0 / 0.45);
    const trade = tracker.recordExit('m1', 0.44, true, 600);

    expect(trade.isTakerExit).toBe(true);
  });

  it('should compute snapshot correctly', () => {
    const tracker = new MicroGabagoolPnlTracker(defaultConfig);

    tracker.recordFill('m1', 0.45, 1.0, 1.0 / 0.45);
    tracker.recordExit('m1', 0.46, false, 60);

    const snapshot = tracker.getSnapshot(new Map());
    expect(snapshot.tradeCount).toBe(1);
    expect(snapshot.winCount).toBe(1);
    expect(snapshot.lossCount).toBe(0);
    expect(snapshot.winRate).toBe(1.0);
    expect(snapshot.makerFillsCount).toBe(1);
    expect(snapshot.takerFillsCount).toBe(0);
  });

  it('should track unrealized PnL', () => {
    const tracker = new MicroGabagoolPnlTracker(defaultConfig);

    tracker.recordFill('m1', 0.45, 1.0, 1.0 / 0.45);

    const snapshot = tracker.getSnapshot(new Map([['m1', 0.46]]));
    expect(snapshot.unrealizedPnlUsd).toBeCloseTo(0.0222, 3);
  });

  it('should throw on exit without position', () => {
    const tracker = new MicroGabagoolPnlTracker(defaultConfig);
    expect(() => tracker.recordExit('m1', 0.46, false, 60)).toThrow('No position');
  });

  it('should track multiple trades', () => {
    const tracker = new MicroGabagoolPnlTracker(defaultConfig);

    tracker.recordFill('m1', 0.45, 1.0, 1.0 / 0.45);
    tracker.recordExit('m1', 0.46, false, 60);

    tracker.recordFill('m2', 0.50, 1.0, 1.0 / 0.50);
    tracker.recordExit('m2', 0.49, false, 30);

    const snapshot = tracker.getSnapshot(new Map());
    expect(snapshot.tradeCount).toBe(2);
    expect(snapshot.winCount).toBe(1);
    expect(snapshot.lossCount).toBe(1);
    expect(snapshot.winRate).toBe(0.5);
  });

  it('should compute gas costs total', () => {
    const tracker = new MicroGabagoolPnlTracker(defaultConfig);

    tracker.recordFill('m1', 0.45, 1.0, 1.0 / 0.45);
    tracker.recordExit('m1', 0.46, false, 60);

    tracker.recordFill('m2', 0.50, 1.0, 1.0 / 0.50);
    tracker.recordExit('m2', 0.51, false, 30);

    const snapshot = tracker.getSnapshot(new Map());
    expect(snapshot.gasCostsTotalUsd).toBeCloseTo(0.008, 3);
  });

  it('should compute rebates total', () => {
    const tracker = new MicroGabagoolPnlTracker(defaultConfig);

    tracker.recordFill('m1', 0.45, 1.0, 1.0 / 0.45);
    tracker.recordExit('m1', 0.46, false, 60);

    tracker.recordFill('m2', 0.50, 1.5, 1.5 / 0.50);
    tracker.recordExit('m2', 0.51, false, 30);

    const snapshot = tracker.getSnapshot(new Map());
    expect(snapshot.rebatesTotalUsd).toBeCloseTo(0.0025, 4);
  });

  it('should get position details', () => {
    const tracker = new MicroGabagoolPnlTracker(defaultConfig);

    tracker.recordFill('m1', 0.45, 1.0, 1.0 / 0.45);
    const pos = tracker.getPosition('m1');

    expect(pos).toBeDefined();
    expect(pos!.entryPrice).toBe(0.45);
    expect(pos!.sizeUsd).toBe(1.0);
  });
});
