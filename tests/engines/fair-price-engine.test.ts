import { computeFairPrice, checkComplementConsistency } from '../../src/engines/fair-price-engine';

describe('fair-price-engine', () => {
  const weights = { microprice: 0.45, midpoint: 0.25, complement: 0.20, lastTradeEma: 0.10, externalSignal: 0.00 };

  test('computes midpoint', () => {
    const result = computeFairPrice({
      bestBid: 0.45, bestAsk: 0.55, bestBidSize: 100, bestAskSize: 100,
      lastTradeEma: null, complementMidpoint: null, weights
    });
    expect(result).not.toBeNull();
    expect(result!.fairPrice).toBeCloseTo(0.50, 2);
    expect(result!.microprice).toBeCloseTo(0.50, 2);
  });

  test('computes microprice', () => {
    const result = computeFairPrice({
      bestBid: 0.45, bestAsk: 0.55, bestBidSize: 100, bestAskSize: 900,
      lastTradeEma: null, complementMidpoint: null, weights
    });
    expect(result!.microprice).toBeCloseTo(0.46, 2);
    expect(result!.fairPrice).toBeCloseTo(0.474, 2);
  });

  test('computes complement-implied yes price', () => {
    const result = computeFairPrice({
      bestBid: 0.45, bestAsk: 0.55, bestBidSize: 100, bestAskSize: 100,
      lastTradeEma: null, complementMidpoint: 0.48, weights
    });
    expect(result!.fairPrice).toBeCloseTo(0.504, 2);
  });

  test('rejects missing best bid', () => {
    const result = computeFairPrice({
      bestBid: 0, bestAsk: 0.55, bestBidSize: 100, bestAskSize: 100,
      lastTradeEma: null, complementMidpoint: null, weights
    });
    expect(result).toBeNull();
  });

  test('rejects missing best ask', () => {
    const result = computeFairPrice({
      bestBid: 0.45, bestAsk: 0, bestBidSize: 100, bestAskSize: 100,
      lastTradeEma: null, complementMidpoint: null, weights
    });
    expect(result).toBeNull();
  });

  test('checkComplementConsistency passes when within tolerance', () => {
    expect(checkComplementConsistency(0.52, 0.48, 2.0)).toBe(true);
    expect(checkComplementConsistency(0.53, 0.48, 2.0)).toBe(true);
  });
});
