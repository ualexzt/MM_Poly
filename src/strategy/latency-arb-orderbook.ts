import { BookState } from '../types/book';
import { MarketSnapshot } from '../engines/divergence-engine';

export interface LatencyArbBookPair {
  yes: BookState;
  no: BookState;
}

export interface LatencyArbExecutionSnapshot {
  yesBestBid: number;
  yesBestAsk: number;
  noBestBid: number;
  noBestAsk: number;
  tickSize: number;
  minOrderSize: number;
}

export interface LatencyArbSnapshotConfig {
  nowMs: number;
  maxMarketAgeMs: number;
  maxSpreadCents: number;
}

export type LatencyArbSnapshotResult =
  | { ok: true; snapshot: MarketSnapshot; execution: LatencyArbExecutionSnapshot }
  | { ok: false; reason: 'stale_orderbook' | 'spread_too_wide' | 'invalid_orderbook_price' };

function isFinitePositive(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function buildLatencyArbSnapshot(
  books: LatencyArbBookPair,
  config: LatencyArbSnapshotConfig
): LatencyArbSnapshotResult {
  const maxAge = Math.max(
    config.nowMs - books.yes.lastUpdateMs,
    config.nowMs - books.no.lastUpdateMs
  );
  if (maxAge > config.maxMarketAgeMs) return { ok: false, reason: 'stale_orderbook' };

  if (
    !isFinitePositive(books.yes.bestBid) ||
    !isFinitePositive(books.yes.bestAsk) ||
    !isFinitePositive(books.no.bestBid) ||
    !isFinitePositive(books.no.bestAsk)
  ) {
    return { ok: false, reason: 'invalid_orderbook_price' };
  }

  const yesSpread = books.yes.bestAsk - books.yes.bestBid;
  const noSpread = books.no.bestAsk - books.no.bestBid;
  if (!Number.isFinite(yesSpread) || !Number.isFinite(noSpread) || yesSpread < 0 || noSpread < 0) {
    return { ok: false, reason: 'invalid_orderbook_price' };
  }

  const maxSpread = Math.max(yesSpread, noSpread);
  if (maxSpread * 100 > config.maxSpreadCents) return { ok: false, reason: 'spread_too_wide' };

  const snapshot: MarketSnapshot = {
    yesPrice: books.yes.bestAsk,
    noPrice: books.no.bestAsk,
    midpoint: (books.yes.bestAsk + books.no.bestAsk) / 2,
    spread: maxSpread,
    timestamp: config.nowMs,
  };

  return {
    ok: true,
    snapshot,
    execution: {
      yesBestBid: books.yes.bestBid,
      yesBestAsk: books.yes.bestAsk,
      noBestBid: books.no.bestBid,
      noBestAsk: books.no.bestAsk,
      tickSize: Math.min(books.yes.tickSize, books.no.tickSize),
      minOrderSize: Math.max(books.yes.minOrderSize, books.no.minOrderSize),
    },
  };
}
