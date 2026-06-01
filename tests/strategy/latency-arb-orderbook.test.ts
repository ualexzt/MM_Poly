import { buildLatencyArbSnapshot, LatencyArbBookPair } from '../../src/strategy/latency-arb-orderbook';
import { BookState } from '../../src/types/book';

const now = 1700000000000;

function book(overrides: Partial<BookState>): BookState {
  return {
    tokenId: 'token',
    conditionId: 'condition',
    bids: [],
    asks: [],
    bestBid: 0.44,
    bestAsk: 0.46,
    bestBidSizeUsd: 100,
    bestAskSizeUsd: 100,
    midpoint: 0.45,
    spread: 0.02,
    spreadTicks: 2,
    depth1Usd: 200,
    depth3Usd: 500,
    tickSize: 0.01,
    minOrderSize: 1,
    lastUpdateMs: now,
    ...overrides,
  };
}

describe('buildLatencyArbSnapshot', () => {
  it('should build snapshot and execution prices from YES and NO books', () => {
    const pair: LatencyArbBookPair = {
      yes: book({ tokenId: 'yes', bestBid: 0.44, bestAsk: 0.46, midpoint: 0.45, spread: 0.02 }),
      no: book({ tokenId: 'no', bestBid: 0.54, bestAsk: 0.56, midpoint: 0.55, spread: 0.02 }),
    };

    const result = buildLatencyArbSnapshot(pair, {
      nowMs: now + 100,
      maxMarketAgeMs: 2000,
      maxSpreadCents: 8,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.snapshot.yesPrice).toBe(0.46);
    expect(result.snapshot.noPrice).toBe(0.56);
    expect(result.execution.yesBestBid).toBe(0.44);
    expect(result.execution.yesBestAsk).toBe(0.46);
    expect(result.execution.noBestBid).toBe(0.54);
    expect(result.execution.noBestAsk).toBe(0.56);
  });

  it('should reject stale books', () => {
    const result = buildLatencyArbSnapshot({ yes: book({}), no: book({}) }, {
      nowMs: now + 5000,
      maxMarketAgeMs: 2000,
      maxSpreadCents: 8,
    });

    expect(result).toEqual({ ok: false, reason: 'stale_orderbook' });
  });

  it('should reject wide spreads', () => {
    const result = buildLatencyArbSnapshot({
      yes: book({ bestBid: 0.40, bestAsk: 0.55, midpoint: 0.475, spread: 0.15 }),
      no: book({ bestBid: 0.45, bestAsk: 0.60, midpoint: 0.525, spread: 0.15 }),
    }, {
      nowMs: now,
      maxMarketAgeMs: 2000,
      maxSpreadCents: 8,
    });

    expect(result).toEqual({ ok: false, reason: 'spread_too_wide' });
  });

  it('should reject missing prices', () => {
    const result = buildLatencyArbSnapshot({ yes: book({ bestAsk: null }), no: book({}) }, {
      nowMs: now,
      maxMarketAgeMs: 2000,
      maxSpreadCents: 8,
    });

    expect(result).toEqual({ ok: false, reason: 'invalid_orderbook_price' });
  });
});
