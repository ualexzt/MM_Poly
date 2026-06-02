import { applyObservedFills, normalizeClobTradesToObservedFills, ObservedFill } from '../../src/execution/live-fill-tracker';
import { PositionTracker } from '../../src/strategy/position-tracker';

describe('applyObservedFills', () => {
  it('updates tracker from confirmed fills', () => {
    const tracker = new PositionTracker();
    const fills: ObservedFill[] = [
      { id: 'fill-1', marketId: 'cid-1', side: 'YES', price: 0.42, sizeShares: 1, marketEndMs: 2_000 },
    ];

    const applied = applyObservedFills(tracker, fills, new Set());

    expect(applied).toHaveLength(1);
    expect(tracker.getPosition('cid-1')).toMatchObject({ yesQty: 1, avgYesPrice: 0.42, marketEndMs: 2_000 });
  });

  it('does not apply the same fill twice', () => {
    const tracker = new PositionTracker();
    const seen = new Set<string>(['fill-1']);
    const fills: ObservedFill[] = [
      { id: 'fill-1', marketId: 'cid-1', side: 'YES', price: 0.42, sizeShares: 1, marketEndMs: 2_000 },
    ];

    const applied = applyObservedFills(tracker, fills, seen);

    expect(applied).toEqual([]);
    expect(tracker.getPosition('cid-1')).toBeNull();
  });

  it('normalizes CLOB BUY trades into observed fills for a known market', () => {
    const fills = normalizeClobTradesToObservedFills([
      { id: 't1', market: 'cid-1', asset_id: 'yes-token', side: 'BUY', price: '0.42', size: '1', status: 'CONFIRMED' },
      { id: 't2', market: 'cid-1', asset_id: 'no-token', side: 'BUY', price: '0.55', size: '2', status: 'MATCHED' },
      { id: 't3', market: 'cid-1', asset_id: 'yes-token', side: 'SELL', price: '0.43', size: '1', status: 'CONFIRMED' },
      { id: 't4', market: 'cid-1', asset_id: 'other-token', side: 'BUY', price: '0.10', size: '1', status: 'CONFIRMED' },
    ], {
      marketId: 'cid-1',
      yesTokenId: 'yes-token',
      noTokenId: 'no-token',
      marketEndMs: 2_000,
    });

    expect(fills).toEqual([
      { id: 't1', marketId: 'cid-1', side: 'YES', price: 0.42, sizeShares: 1, marketEndMs: 2_000 },
      { id: 't2', marketId: 'cid-1', side: 'NO', price: 0.55, sizeShares: 2, marketEndMs: 2_000 },
    ]);
  });
});
