import { PositionTracker } from '../strategy/position-tracker';

export interface ObservedFill {
  id: string;
  marketId: string;
  side: 'YES' | 'NO';
  price: number;
  sizeShares: number;
  marketEndMs?: number;
}

export function applyObservedFills(
  tracker: PositionTracker,
  fills: ObservedFill[],
  seenFillIds: Set<string>,
): ObservedFill[] {
  const applied: ObservedFill[] = [];

  for (const fill of fills) {
    if (seenFillIds.has(fill.id)) continue;
    tracker.updateFill(fill.marketId, fill.side, fill.price, fill.sizeShares, fill.marketEndMs);
    seenFillIds.add(fill.id);
    applied.push(fill);
  }

  return applied;
}
