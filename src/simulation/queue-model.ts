import { BookState } from '../types/book';

export type QueuePosition = 'behind_existing_size' | 'at_front' | 'improving';

/**
 * Queue Model — §16.1, §16.2
 * Estimates queue position for a passive order.
 *
 * Default rule: order is placed behind all existing size at that price level.
 * Fill only occurs after prior visible size is consumed (§16.2).
 */
export function estimateQueuePosition(
  orderPrice: number,
  orderSide: 'BUY' | 'SELL',
  book: BookState
): QueuePosition {
  if (orderSide === 'BUY') {
    const bestBid = book.bestBid;
    if (bestBid === null) return 'at_front';
    if (Math.abs(orderPrice - bestBid) < book.tickSize * 0.5) {
      // Joining best bid → behind existing size
      return 'behind_existing_size';
    }
    // Improving = new best bid (one tick better)
    if (orderPrice > bestBid) return 'improving';
    return 'behind_existing_size';
  } else {
    const bestAsk = book.bestAsk;
    if (bestAsk === null) return 'at_front';
    if (Math.abs(orderPrice - bestAsk) < book.tickSize * 0.5) {
      return 'behind_existing_size';
    }
    if (orderPrice < bestAsk) return 'improving';
    return 'behind_existing_size';
  }
}

/**
 * Estimates the size ahead of our order in the queue.
 * Used by the paper simulator to determine partial fills (§16.2).
 */
export function estimateSizeAheadUsd(
  orderPrice: number,
  orderSide: 'BUY' | 'SELL',
  book: BookState
): number {
  if (orderSide === 'BUY') {
    const level = book.bids.find(b => Math.abs(b.price - orderPrice) < book.tickSize * 0.5);
    return level ? level.sizeUsd : 0;
  } else {
    const level = book.asks.find(a => Math.abs(a.price - orderPrice) < book.tickSize * 0.5);
    return level ? level.sizeUsd : 0;
  }
}
