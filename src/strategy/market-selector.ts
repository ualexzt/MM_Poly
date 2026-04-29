import { MarketState } from '../types/market';
import { MarketFilterConfig } from '../types/config';
import { BookState } from '../types/book';

/**
 * Checks all 14 hard market filters from §4.1.
 * A market is eligible only if ALL required hard filters pass.
 */
export function filterEligibleMarkets(
  markets: MarketState[],
  config: MarketFilterConfig,
  books?: Map<string, BookState>
): MarketState[] {
  return markets.filter(m => isMarketEligible(m, config, books));
}

export function isMarketEligible(
  m: MarketState,
  config: MarketFilterConfig,
  books?: Map<string, BookState>
): boolean {
  // §4.1 — basic status filters
  if (config.active && !m.active) return false;
  if (!config.closed && m.closed) return false;                      // closed markets excluded
  if (config.enableOrderBook && !m.enableOrderBook) return false;
  if (config.feesEnabled && !m.feesEnabled) return false;

  // §4.1 — liquidity filters
  if (m.volume24hUsd < config.minVolume24hUsd) return false;
  if (m.liquidityUsd < config.minLiquidityUsd) return false;

  // §4.1 — oracle / risk
  if (m.oracleAmbiguityScore > config.maxOracleAmbiguityScore) return false;
  if (config.requireValidResolutionSource && !m.resolutionSource) return false;

  // §4.1 — time-to-resolution (using endDate)
  if (m.endDate) {
    const msToEnd = new Date(m.endDate).getTime() - Date.now();
    const minutesToEnd = msToEnd / 60000;
    if (minutesToEnd < config.minTimeToResolutionMinutes) return false;
    if (minutesToEnd < config.disableNearResolutionMinutes) return false;
  }

  // §4.1 — book-level filters (require live book data)
  if (books) {
    const yesBook = books.get(m.yesTokenId);
    if (!yesBook) return false;

    // Midpoint range
    if (yesBook.midpoint === null) return false;
    if (yesBook.midpoint < config.midpointMin) return false;
    if (yesBook.midpoint > config.midpointMax) return false;

    // Depth filters
    if (yesBook.depth1Usd < config.minBestLevelDepthUsd) return false;
    if (yesBook.depth3Usd < config.minDepth3LevelsUsd) return false;

    // Spread filters
    if (yesBook.spreadTicks !== null && yesBook.spreadTicks < config.minSpreadTicks) return false;
    const spreadCents = (yesBook.spread ?? 0) * 100;
    if (spreadCents > config.maxSpreadCents) return false;
  }

  return true;
}

/**
 * §4.3 — Exclusion rules checked at quote-time (dynamic conditions).
 * Returns the first failing reason, or null if all pass.
 */
export function getExclusionReason(
  m: MarketState,
  book: BookState,
  wsConnected: boolean,
  inventoryHardLimitBreached: boolean,
  recentToxicFlowDetected: boolean
): string | null {
  if (m.closed) return 'market_is_closed';
  if (!m.active) return 'market_is_paused_or_halted';
  if (!book.bestBid || !book.bestAsk) return 'orderbook_missing_or_empty';
  if (book.spreadTicks !== null && book.spreadTicks < 1) return 'spread_too_tight';
  if (!wsConnected) return 'websocket_disconnected';
  if (!book.tickSize) return 'tick_size_unknown';
  if (!book.minOrderSize) return 'min_order_size_unknown';
  if (inventoryHardLimitBreached) return 'inventory_hard_limit_reached';
  if (recentToxicFlowDetected) return 'recent_toxic_flow_detected';

  // Near-resolution guard
  if (m.endDate) {
    const minutesToEnd = (new Date(m.endDate).getTime() - Date.now()) / 60000;
    if (minutesToEnd < 30) return 'market_close_less_than_disable_window';
  }

  return null;
}
