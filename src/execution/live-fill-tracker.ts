import { PositionTracker } from '../strategy/position-tracker';

export interface ObservedFill {
  id: string;
  marketId: string;
  side: 'YES' | 'NO';
  price: number;
  sizeShares: number;
  marketEndMs?: number;
}

export interface ClobTradeLike {
  id: string;
  market: string;
  asset_id: string;
  side?: string;
  price: string | number;
  size: string | number;
  status?: string;
}

export interface FillMarketContext {
  marketId: string;
  yesTokenId: string;
  noTokenId: string;
  marketEndMs?: number;
}

export function normalizeClobTradesToObservedFills(
  trades: ClobTradeLike[],
  market: FillMarketContext,
): ObservedFill[] {
  const fills: ObservedFill[] = [];

  for (const trade of trades) {
    if (trade.market !== market.marketId) continue;
    if (trade.side !== undefined && trade.side !== 'BUY') continue;
    if (trade.status !== undefined && ['FAILED', 'CANCELLED', 'REJECTED'].includes(trade.status)) continue;

    const side = trade.asset_id === market.yesTokenId ? 'YES'
      : trade.asset_id === market.noTokenId ? 'NO'
        : null;
    if (side === null) continue;

    const price = Number(trade.price);
    const sizeShares = Number(trade.size);
    if (!Number.isFinite(price) || !Number.isFinite(sizeShares) || sizeShares <= 0) continue;

    fills.push({
      id: trade.id,
      marketId: market.marketId,
      side,
      price,
      sizeShares,
      marketEndMs: market.marketEndMs,
    });
  }

  return fills;
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
