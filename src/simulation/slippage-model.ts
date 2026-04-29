import { BookState } from '../types/book';

/**
 * Slippage Model — §16.1 (paper_simulator fill_model)
 * Estimates slippage cost for paper fills.
 */

/**
 * Estimates slippage cost for a passive fill.
 * For post-only orders, slippage is zero by definition (we set the price).
 * We model slippage as the difference between the fair price at fill time
 * and the actual fill price (adverse selection proxy).
 */
export function estimateSlippage(
  fillPrice: number,
  fairPriceAtFill: number,
  side: 'BUY' | 'SELL'
): number {
  if (side === 'BUY') {
    // We paid fillPrice; fair was fairPriceAtFill
    // Positive slippage = we paid more than fair (bad)
    return Math.max(0, fillPrice - fairPriceAtFill);
  } else {
    // We received fillPrice; fair was fairPriceAtFill
    // Positive slippage = we received less than fair (bad)
    return Math.max(0, fairPriceAtFill - fillPrice);
  }
}

/**
 * Queue-position-aware fill probability.
 * Approximates whether a passive order at the given price would fill
 * given the current book depth ahead of us.
 *
 * Returns fill probability in [0, 1].
 */
export function estimateFillProbability(
  orderPrice: number,
  side: 'BUY' | 'SELL',
  book: BookState,
  tradeSize: number
): number {
  if (side === 'BUY') {
    const levelDepthAhead = book.bestBidSizeUsd; // simplified: treat best bid as queue
    if (levelDepthAhead <= 0) return 1.0; // empty queue → front of line
    // Fill prob = fraction of trade size that exceeds queue ahead
    return Math.min(1.0, tradeSize / (levelDepthAhead + tradeSize));
  } else {
    const levelDepthAhead = book.bestAskSizeUsd;
    if (levelDepthAhead <= 0) return 1.0;
    return Math.min(1.0, tradeSize / (levelDepthAhead + tradeSize));
  }
}
