import { computeToxicityScore, getToxicityAction, checkHardToxicityCancel } from '../../src/engines/toxicity-engine';

describe('toxicity-engine', () => {
  test('low toxicity allows quote', () => {
    const score = computeToxicityScore({
      conditionId: 'cond-1', tokenId: 'token-1',
      trades10s: 0, trades30s: 1, trades60s: 2,
      takerBuyVolume60sUsd: 10, takerSellVolume60sUsd: 10,
      largeTradeCount60s: 0,
      midpointChange10sCents: 0, midpointChange60sCents: 0.2,
      bookHashChanges10s: 0, wsDisconnectsLast5m: 0
    });
    expect(score).toBeLessThanOrEqual(0.25);
    expect(getToxicityAction(score)).toBe('quote_normally');
  });

  test('medium toxicity widens quote', () => {
    const score = computeToxicityScore({
      conditionId: 'cond-1', tokenId: 'token-1',
      trades10s: 3, trades30s: 8, trades60s: 15,
      takerBuyVolume60sUsd: 500, takerSellVolume60sUsd: 100,
      largeTradeCount60s: 0,
      midpointChange10sCents: 0.5, midpointChange60sCents: 1.5,
      bookHashChanges10s: 2, wsDisconnectsLast5m: 0
    });
    expect(score).toBeGreaterThan(0.25);
    expect(score).toBeLessThanOrEqual(0.45);
    expect(getToxicityAction(score)).toBe('widen_quotes');
  });

  test('high toxicity cancels or exit only', () => {
    const score = computeToxicityScore({
      conditionId: 'cond-1', tokenId: 'token-1',
      trades10s: 8, trades30s: 20, trades60s: 40,
      takerBuyVolume60sUsd: 2000, takerSellVolume60sUsd: 200,
      largeTradeCount60s: 1,
      midpointChange10sCents: 1.0, midpointChange60sCents: 2.5,
      bookHashChanges10s: 4, wsDisconnectsLast5m: 0
    });
    expect(score).toBeGreaterThan(0.45);
    expect(score).toBeLessThanOrEqual(0.65);
    expect(getToxicityAction(score)).toBe('quote_exit_only_or_cancel');
  });

  test('critical toxicity cancels all', () => {
    const score = computeToxicityScore({
      conditionId: 'cond-1', tokenId: 'token-1',
      trades10s: 20, trades30s: 50, trades60s: 100,
      takerBuyVolume60sUsd: 5000, takerSellVolume60sUsd: 500,
      largeTradeCount60s: 3,
      midpointChange10sCents: 2.0, midpointChange60sCents: 5.0,
      bookHashChanges10s: 10, wsDisconnectsLast5m: 1
    });
    expect(score).toBeGreaterThan(0.65);
    expect(getToxicityAction(score)).toBe('cancel_all_market_orders');
  });

  test('large trade triggers hard cancel', () => {
    expect(checkHardToxicityCancel(
      { midpointMove10sCents: 0.5, midpointMove60sCents: 1.0, largeTradeUsd: 1500, bookHashChanges10s: 2, spreadTicks: 3, bookStaleMs: 500, wsDisconnectedSeconds: 0 },
      { cancelIfMidpointMoves10sCentsGte: 1.5, cancelIfMidpointMoves60sCentsGte: 3.0, cancelIfLargeTradeUsdGte: 1000, cancelIfHashChanges10sGte: 8, cancelIfSpreadTicksLte: 1, cooldownAfterCancelSeconds: 20 }
    )).toBe(true);
  });

  test('midpoint velocity triggers hard cancel', () => {
    expect(checkHardToxicityCancel(
      { midpointMove10sCents: 2.0, midpointMove60sCents: 1.0, largeTradeUsd: 100, bookHashChanges10s: 2, spreadTicks: 3, bookStaleMs: 500, wsDisconnectedSeconds: 0 },
      { cancelIfMidpointMoves10sCentsGte: 1.5, cancelIfMidpointMoves60sCentsGte: 3.0, cancelIfLargeTradeUsdGte: 1000, cancelIfHashChanges10sGte: 8, cancelIfSpreadTicksLte: 1, cooldownAfterCancelSeconds: 20 }
    )).toBe(true);
  });

  test('book hash instability triggers hard cancel', () => {
    expect(checkHardToxicityCancel(
      { midpointMove10sCents: 0, midpointMove60sCents: 0, largeTradeUsd: 0, bookHashChanges10s: 10, spreadTicks: 5, bookStaleMs: 500, wsDisconnectedSeconds: 0 },
      { cancelIfMidpointMoves10sCentsGte: 1.5, cancelIfMidpointMoves60sCentsGte: 3.0, cancelIfLargeTradeUsdGte: 1000, cancelIfHashChanges10sGte: 8, cancelIfSpreadTicksLte: 1, cooldownAfterCancelSeconds: 20 }
    )).toBe(true);
  });
});
