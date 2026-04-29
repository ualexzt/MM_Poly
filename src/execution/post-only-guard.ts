import { BookState } from '../types/book';
import { QuoteCandidate } from '../types/quote';

/**
 * Post-Only Guard — §10.4, §12.2
 * Ensures BUY price < bestAsk and SELL price > bestBid before submit.
 */

export interface PostOnlyCheckResult {
  safe: boolean;
  adjustedPrice?: number;
  reason?: string;
}

/**
 * Checks and optionally adjusts the quote price to be post-only safe.
 * If adjustment is impossible (price goes out of (0,1)), returns safe=false.
 */
export function checkPostOnly(quote: QuoteCandidate, book: BookState): PostOnlyCheckResult {
  const { side, price } = quote;

  if (side === 'BUY') {
    if (book.bestAsk === null) return { safe: false, reason: 'no_best_ask' };
    if (price < book.bestAsk) return { safe: true };
    // Adjust: move one tick below bestAsk
    const adjusted = Math.round((book.bestAsk - book.tickSize) * 10000) / 10000;
    if (adjusted <= 0) return { safe: false, reason: 'adjusted_price_out_of_range' };
    return { safe: true, adjustedPrice: adjusted, reason: 'adjusted_below_best_ask' };
  } else {
    if (book.bestBid === null) return { safe: false, reason: 'no_best_bid' };
    if (price > book.bestBid) return { safe: true };
    // Adjust: move one tick above bestBid
    const adjusted = Math.round((book.bestBid + book.tickSize) * 10000) / 10000;
    if (adjusted >= 1) return { safe: false, reason: 'adjusted_price_out_of_range' };
    return { safe: true, adjustedPrice: adjusted, reason: 'adjusted_above_best_bid' };
  }
}

/**
 * Validate all pre-submit conditions (§12.2 order validation checklist).
 */
export function validateOrderPreSubmit(params: {
  quote: QuoteCandidate;
  book: BookState;
  liveTradingEnabled: boolean;
  mode: string;
  exposureAllowed: boolean;
  sellInventoryAvailable: boolean;
  killSwitchActive: boolean;
}): { valid: boolean; reason: string } {
  const { quote, book, liveTradingEnabled, mode, exposureAllowed, sellInventoryAvailable, killSwitchActive } = params;

  if (killSwitchActive) return { valid: false, reason: 'kill_switch_active' };
  if (mode === 'paper' && liveTradingEnabled) return { valid: false, reason: 'live_flag_set_in_paper_mode' };
  if (!book.bestBid || !book.bestAsk) return { valid: false, reason: 'book_not_fresh' };
  if (quote.price <= 0 || quote.price >= 1) return { valid: false, reason: 'price_out_of_range' };

  // Price tick alignment
  const remainder = Math.round(quote.price * 10000) % Math.round(book.tickSize * 10000);
  if (remainder !== 0) return { valid: false, reason: 'price_misaligned_to_tick' };

  if (quote.size < book.minOrderSize) return { valid: false, reason: 'size_below_exchange_min' };
  if (!exposureAllowed) return { valid: false, reason: 'exposure_limit_exceeded' };
  if (quote.side === 'SELL' && !sellInventoryAvailable) return { valid: false, reason: 'insufficient_sell_inventory' };

  // Post-only safety
  const postOnly = checkPostOnly(quote, book);
  if (!postOnly.safe) return { valid: false, reason: `post_only_unsafe:${postOnly.reason}` };

  return { valid: true, reason: 'ok' };
}
