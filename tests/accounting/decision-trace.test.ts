import { createTrace } from '../../src/accounting/decision-trace';

describe('decision-trace', () => {
  test('creates trace with all required fields', () => {
    const trace = createTrace({
      mode: 'paper', conditionId: 'c1', tokenId: 't1', side: 'BUY',
      bestBid: 0.45, bestAsk: 0.55, spreadTicks: 10,
      fairPrice: 0.50, microprice: 0.50, complementFair: null, lastTradeEma: null,
      toxicityScore: 0.1, inventoryPct: 0, inventorySkewCents: 0,
      targetPrice: 0.49, targetSizeUsd: 10,
      decision: 'quote', reason: 'normal', riskFlags: []
    });
    expect(trace.conditionId).toBe('c1');
    expect(trace.decision).toBe('quote');
    expect(trace.timestampMs).toBeGreaterThan(0);
  });
});
