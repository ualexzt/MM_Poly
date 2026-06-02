import {
  PositionTracker,
  TrackedPosition,
} from '../../src/strategy/position-tracker';

describe('PositionTracker', () => {
  it('starts with empty positions', () => {
    const tracker = new PositionTracker();
    expect(tracker.getPositions().size).toBe(0);
    expect(tracker.getPosition('cid-1')).toBeNull();
  });

  it('records a YES fill', () => {
    const tracker = new PositionTracker();
    tracker.updateFill('cid-1', 'YES', 0.45, 10);

    const pos = tracker.getPosition('cid-1')!;
    expect(pos.yesQty).toBe(10);
    expect(pos.noQty).toBe(0);
    expect(pos.avgYesPrice).toBeCloseTo(0.45);
    expect(pos.totalYesCostUsd).toBeCloseTo(4.5);
  });

  it('records a NO fill', () => {
    const tracker = new PositionTracker();
    tracker.updateFill('cid-1', 'NO', 0.50, 8);

    const pos = tracker.getPosition('cid-1')!;
    expect(pos.yesQty).toBe(0);
    expect(pos.noQty).toBe(8);
    expect(pos.avgNoPrice).toBeCloseTo(0.50);
  });

  it('accumulates multiple YES fills with weighted average', () => {
    const tracker = new PositionTracker();
    tracker.updateFill('cid-1', 'YES', 0.40, 10); // $4.00
    tracker.updateFill('cid-1', 'YES', 0.50, 10); // $5.00

    const pos = tracker.getPosition('cid-1')!;
    expect(pos.yesQty).toBe(20);
    expect(pos.avgYesPrice).toBeCloseTo(0.45); // (4+5)/20 = 0.45
  });

  it('accumulates YES and NO independently', () => {
    const tracker = new PositionTracker();
    tracker.updateFill('cid-1', 'YES', 0.42, 10);
    tracker.updateFill('cid-1', 'NO', 0.48, 10);

    const pos = tracker.getPosition('cid-1')!;
    expect(pos.yesQty).toBe(10);
    expect(pos.noQty).toBe(10);
    expect(pos.avgYesPrice).toBeCloseTo(0.42);
    expect(pos.avgNoPrice).toBeCloseTo(0.48);
  });

  it('tracks multiple markets independently', () => {
    const tracker = new PositionTracker();
    tracker.updateFill('cid-1', 'YES', 0.45, 10);
    tracker.updateFill('cid-2', 'NO', 0.50, 5);

    expect(tracker.getPosition('cid-1')!.yesQty).toBe(10);
    expect(tracker.getPosition('cid-2')!.noQty).toBe(5);
    expect(tracker.getPositions().size).toBe(2);
  });

  it('calculates avg pair cost when both sides exist', () => {
    const tracker = new PositionTracker();
    tracker.updateFill('cid-1', 'YES', 0.42, 10);
    tracker.updateFill('cid-1', 'NO', 0.48, 10);

    expect(tracker.getAvgPairCost('cid-1')).toBeCloseTo(0.90);
  });

  it('returns null for avg pair cost when only one side', () => {
    const tracker = new PositionTracker();
    tracker.updateFill('cid-1', 'YES', 0.42, 10);

    expect(tracker.getAvgPairCost('cid-1')).toBeNull();
  });

  it('returns null for avg pair cost when no position', () => {
    const tracker = new PositionTracker();
    expect(tracker.getAvgPairCost('cid-1')).toBeNull();
  });

  it('calculates total exposure across all markets', () => {
    const tracker = new PositionTracker();
    tracker.updateFill('cid-1', 'YES', 0.45, 10); // $4.50
    tracker.updateFill('cid-1', 'NO', 0.50, 10);  // $5.00
    tracker.updateFill('cid-2', 'YES', 0.40, 5);   // $2.00

    expect(tracker.getTotalExposureUsd()).toBeCloseTo(11.50);
  });

  it('closes expired 15-minute market positions and releases exposure', () => {
    const tracker = new PositionTracker();
    tracker.updateFill('expired', 'YES', 0.45, 2, 1_000);
    tracker.updateFill('expired', 'NO', 0.50, 2, 1_000);
    tracker.updateFill('active', 'YES', 0.40, 2, 10_000);

    const closed = tracker.closeExpiredPositions(1_001);

    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({
      marketId: 'expired',
      yesQty: 2,
      noQty: 2,
      pairCost: 0.95,
      exposureUsd: 1.9,
    });
    expect(closed[0].lockedProfitUsd).toBeCloseTo(0.1);
    expect(tracker.getPosition('expired')).toBeNull();
    expect(tracker.getPosition('active')).not.toBeNull();
    expect(tracker.getTotalExposureUsd()).toBeCloseTo(0.8);
  });
});
