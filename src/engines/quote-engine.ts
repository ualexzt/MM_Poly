import { BookState } from '../types/book';
import { QuoteCandidate } from '../types/quote';
import { roundDownToTick, roundUpToTick } from '../utils/math';

export interface QuoteEngineInputs {
  conditionId: string;
  tokenId: string;
  side: 'BUY' | 'SELL';
  fairPrice: number;
  targetHalfSpreadCents: number;
  inventorySkewCents: number;
  toxicityScore: number;
  book: BookState;
  baseSizeUsd: number;
  maxSizeUsd: number;
  minOrderSize: number;
  isBookStale?: boolean;
}

export function generateQuoteCandidates(inputs: QuoteEngineInputs): QuoteCandidate[] {
  const { conditionId, tokenId, side, fairPrice, targetHalfSpreadCents, inventorySkewCents, toxicityScore, book, baseSizeUsd, maxSizeUsd, minOrderSize, isBookStale } = inputs;

  if (isBookStale) return [];
  if (!book.bestBid || !book.bestAsk) return [];

  const halfSpread = targetHalfSpreadCents / 100;
  const skew = inventorySkewCents / 100;

  let rawPrice: number;
  if (side === 'BUY') {
    rawPrice = fairPrice - halfSpread - skew;
  } else {
    rawPrice = fairPrice + halfSpread - skew;
  }

  let price = side === 'BUY' ? roundDownToTick(rawPrice, book.tickSize) : roundUpToTick(rawPrice, book.tickSize);

  if (side === 'BUY' && price >= book.bestAsk) {
    price = roundDownToTick(book.bestAsk - book.tickSize, book.tickSize);
  }
  if (side === 'SELL' && price <= book.bestBid) {
    price = roundUpToTick(book.bestBid + book.tickSize, book.tickSize);
  }

  if (price <= 0 || price >= 1) return [];

  let size = baseSizeUsd / price;
  size = Math.max(minOrderSize, Math.ceil(size));
  size = Math.min(size, Math.floor(maxSizeUsd / price));

  if (size < minOrderSize) return [];

  return [{
    conditionId, tokenId, side, price, size,
    sizeUsd: size * price,
    orderType: 'GTC',
    postOnly: true,
    fairPrice, targetHalfSpreadCents, inventorySkewCents, toxicityScore,
    reason: 'quote_generated',
    riskFlags: []
  }];
}
