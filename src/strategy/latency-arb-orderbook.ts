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
  | {
      ok: false;
      reason:
        | 'stale_orderbook'
        | 'spread_too_wide'
        | 'invalid_orderbook_price'
        | 'invalid_orderbook_timestamp';
    };

function isValidBinaryPrice(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1;
}

function isFinitePositive(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function ageMs(nowMs: number, lastUpdateMs: number): number | null {
  if (!Number.isFinite(nowMs) || !Number.isFinite(lastUpdateMs)) return null;
  const age = nowMs - lastUpdateMs;
  // Allow small positive clock skew (book fetched after nowMs captured)
  if (age < 0 && age > -5000) return 0;
  return age >= 0 ? age : null;
}

export function buildLatencyArbSnapshot(
  books: LatencyArbBookPair,
  config: LatencyArbSnapshotConfig
): LatencyArbSnapshotResult {
  const yesAgeMs = ageMs(config.nowMs, books.yes.lastUpdateMs);
  const noAgeMs = ageMs(config.nowMs, books.no.lastUpdateMs);
  if (yesAgeMs === null || noAgeMs === null) {
    return { ok: false, reason: 'invalid_orderbook_timestamp' };
  }

  const maxAge = Math.max(yesAgeMs, noAgeMs);
  if (maxAge > config.maxMarketAgeMs) return { ok: false, reason: 'stale_orderbook' };

  if (
    !isValidBinaryPrice(books.yes.bestBid) ||
    !isValidBinaryPrice(books.yes.bestAsk) ||
    !isValidBinaryPrice(books.no.bestBid) ||
    !isValidBinaryPrice(books.no.bestAsk) ||
    !isFinitePositive(books.yes.tickSize) ||
    !isFinitePositive(books.no.tickSize) ||
    !isFinitePositive(books.yes.minOrderSize) ||
    !isFinitePositive(books.no.minOrderSize)
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
      tickSize: Math.max(books.yes.tickSize, books.no.tickSize),
      minOrderSize: Math.max(books.yes.minOrderSize, books.no.minOrderSize),
    },
  };
}
