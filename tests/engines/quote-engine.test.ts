import { generateQuoteCandidates, generateQuoteCandidate } from '../../src/engines/quote-engine';
import { BookState } from '../../src/types/book';

describe('quote-engine', () => {
  const baseBook: BookState = {
    tokenId: 'yes1', conditionId: 'cond1',
    bids: [{ price: 0.45, size: 100, sizeUsd: 45 }],
    asks: [{ price: 0.55, size: 100, sizeUsd: 55 }],
    bestBid: 0.45, bestAsk: 0.55,
    bestBidSizeUsd: 45, bestAskSizeUsd: 55,
    midpoint: 0.50, spread: 0.10, spreadTicks: 10,
    depth1Usd: 100, depth3Usd: 500,
    tickSize: 0.01, minOrderSize: 1,
    lastUpdateMs: Date.now()
  };

  test('generates post-only bid below best ask', () => {
    const quotes = generateQuoteCandidates({
      conditionId: 'cond1', tokenId: 'yes1', side: 'BUY',
      fairPrice: 0.50, targetHalfSpreadCents: 1.0, inventorySkewCents: 0,
      toxicityScore: 0.1, book: baseBook,
      baseSizeUsd: 10, maxSizeUsd: 25, minOrderSize: 1
    });
    expect(quotes.length).toBe(1);
    expect(quotes[0].price).toBeLessThan(baseBook.bestAsk!);
    expect(quotes[0].postOnly).toBe(true);
  });

  test('generates post-only ask above best bid', () => {
    const quotes = generateQuoteCandidates({
      conditionId: 'cond1', tokenId: 'yes1', side: 'SELL',
      fairPrice: 0.50, targetHalfSpreadCents: 1.0, inventorySkewCents: 0,
      toxicityScore: 0.1, book: baseBook,
      baseSizeUsd: 10, maxSizeUsd: 25, minOrderSize: 1
    });
    expect(quotes.length).toBe(1);
    expect(quotes[0].price).toBeGreaterThan(baseBook.bestBid!);
  });

  test('does not cross spread', () => {
    const quotes = generateQuoteCandidates({
      conditionId: 'cond1', tokenId: 'yes1', side: 'BUY',
      fairPrice: 0.54, targetHalfSpreadCents: 1.0, inventorySkewCents: 0,
      toxicityScore: 0.1, book: baseBook,
      baseSizeUsd: 10, maxSizeUsd: 25, minOrderSize: 1
    });
    expect(quotes[0].price).toBeLessThan(baseBook.bestAsk!);
  });

  test('respects tick size', () => {
    const quotes = generateQuoteCandidates({
      conditionId: 'cond1', tokenId: 'yes1', side: 'BUY',
      fairPrice: 0.501, targetHalfSpreadCents: 1.0, inventorySkewCents: 0,
      toxicityScore: 0.1, book: baseBook,
      baseSizeUsd: 10, maxSizeUsd: 25, minOrderSize: 1
    });
    expect(quotes[0].price).toBe(0.49);
  });

  test('respects min order size', () => {
    const quotes = generateQuoteCandidates({
      conditionId: 'cond1', tokenId: 'yes1', side: 'BUY',
      fairPrice: 0.50, targetHalfSpreadCents: 1.0, inventorySkewCents: 0,
      toxicityScore: 0.1, book: baseBook,
      baseSizeUsd: 5, maxSizeUsd: 25, minOrderSize: 10
    });
    expect(quotes[0].size).toBeGreaterThanOrEqual(10);
  });

  test('skips quote when book stale', () => {
    const staleBook = { ...baseBook, lastUpdateMs: Date.now() - 10000 };
    const quotes = generateQuoteCandidates({
      conditionId: 'cond1', tokenId: 'yes1', side: 'BUY',
      fairPrice: 0.50, targetHalfSpreadCents: 1.0, inventorySkewCents: 0,
      toxicityScore: 0.1, book: staleBook,
      baseSizeUsd: 10, maxSizeUsd: 25, minOrderSize: 1,
      isBookStale: true
    });
    expect(quotes.length).toBe(0);
  });

  test('respects max order size', () => {
    const result = generateQuoteCandidate({
      conditionId: 'cond1', tokenId: 'yes1', side: 'BUY',
      fairPrice: 0.50, book: baseBook,
      spread: { baseHalfSpreadCents: 1.0, minHalfSpreadTicks: 1, adverseSelectionBufferCents: 0, toxicityWideningMaxCents: 2, inventoryWideningMaxCents: 2, volatilityMultiplier: 1, rewardTighteningMaxCents: 1 },
      size: { baseOrderSizeUsd: 100, maxOrderSizeUsd: 25, minSizeMultiplierOverExchangeMin: 1, respectRewardMinIncentiveSize: false },
      toxicityScore: 0.1, inventoryPct: 0, inventorySkewCents: 0,
    });
    expect(result!.candidate.sizeUsd).toBeLessThanOrEqual(25);
  });

  test('respects reward min incentive size', () => {
    const result = generateQuoteCandidate({
      conditionId: 'cond1', tokenId: 'yes1', side: 'BUY',
      fairPrice: 0.50, book: baseBook,
      spread: { baseHalfSpreadCents: 1.0, minHalfSpreadTicks: 1, adverseSelectionBufferCents: 0, toxicityWideningMaxCents: 2, inventoryWideningMaxCents: 2, volatilityMultiplier: 1, rewardTighteningMaxCents: 1 },
      size: { baseOrderSizeUsd: 10, maxOrderSizeUsd: 100, minSizeMultiplierOverExchangeMin: 1, respectRewardMinIncentiveSize: true },
      toxicityScore: 0.1, inventoryPct: 0, inventorySkewCents: 0,
      rewardConfig: { enabled: true, rewardPoolUsd: 100, minIncentiveSizeUsd: 50, maxIncentiveSpreadCents: 4 }
    });
    expect(result!.candidate.sizeUsd).toBeGreaterThanOrEqual(49); // Price is ~0.49, 103 shares = 50.47
  });
});
