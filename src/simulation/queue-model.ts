import { BookState } from '../types/book';

export type QueuePosition = 'behind_existing_size' | 'at_front';

export function estimateQueuePosition(
  orderPrice: number,
  orderSide: 'BUY' | 'SELL',
  book: BookState
): QueuePosition {
  return 'behind_existing_size';
}
