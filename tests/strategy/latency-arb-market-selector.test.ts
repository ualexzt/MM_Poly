import { selectLatencyArbMarkets, LatencyArbMarketSelectionConfig } from '../../src/strategy/latency-arb-market-selector';
import { MarketState } from '../../src/types/market';

const now = 1700000000000;

function market(overrides: Partial<MarketState>): MarketState {
  return {
    conditionId: 'cond-default',
    slug: 'bitcoin-up-or-down-default-15m',
    question: 'Bitcoin Up or Down - 15m',
    yesTokenId: 'yes-default',
    noTokenId: 'no-default',
    active: true,
    closed: false,
    enableOrderBook: true,
    feesEnabled: true,
    endDate: new Date(now + 15 * 60_000).toISOString(),
    volume24hUsd: 1000,
    liquidityUsd: 1000,
    oracleAmbiguityScore: 0.05,
    ...overrides,
  };
}

describe('selectLatencyArbMarkets', () => {
  const config: LatencyArbMarketSelectionConfig = {
    asset: 'BTC',
    durationMinutes: 15,
    maxMarkets: 2,
    nowMs: now,
  };

  it('should select active BTC 15m up/down markets with token ids', () => {
    const markets = [
      market({ conditionId: 'btc-15', slug: 'bitcoin-up-or-down-15m-1' }),
      market({ conditionId: 'eth-15', slug: 'ethereum-up-or-down-15m', question: 'Ethereum Up or Down - 15m' }),
      market({ conditionId: 'btc-5', slug: 'bitcoin-up-or-down-5m', question: 'Bitcoin Up or Down - 5m' }),
      market({ conditionId: 'btc-closed', closed: true }),
      market({ conditionId: 'btc-no-book', enableOrderBook: false }),
      market({ conditionId: 'btc-no-tokens', yesTokenId: '', noTokenId: '' }),
    ];

    const selected = selectLatencyArbMarkets(markets, config);

    expect(selected.map((m) => m.conditionId)).toEqual(['btc-15']);
  });

  it('should order eligible markets by nearest future end date and respect maxMarkets', () => {
    const markets = [
      market({ conditionId: 'later', endDate: new Date(now + 30 * 60_000).toISOString() }),
      market({ conditionId: 'nearest', endDate: new Date(now + 5 * 60_000).toISOString() }),
      market({ conditionId: 'second', endDate: new Date(now + 10 * 60_000).toISOString() }),
    ];

    const selected = selectLatencyArbMarkets(markets, config);

    expect(selected.map((m) => m.conditionId)).toEqual(['nearest', 'second']);
  });

  it('should ignore expired markets when endDate is known', () => {
    const markets = [
      market({ conditionId: 'expired', endDate: new Date(now - 60_000).toISOString() }),
      market({ conditionId: 'future', endDate: new Date(now + 60_000).toISOString() }),
    ];

    const selected = selectLatencyArbMarkets(markets, config);

    expect(selected.map((m) => m.conditionId)).toEqual(['future']);
  });
});
