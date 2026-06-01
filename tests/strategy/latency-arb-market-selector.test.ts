import { selectLatencyArbMarkets, LatencyArbMarketSelectionConfig, LatencyArbMarketFetcher, buildCrypto15mSlug } from '../../src/strategy/latency-arb-market-selector';
import { MarketState } from '../../src/types/market';

const now = 1700000000000;
const slotMs = Math.floor(now / 900000) * 900000;
const slotUnix = Math.floor(slotMs / 1000);

function market(overrides: Partial<MarketState> = {}): MarketState {
  return {
    conditionId: 'cond-btc-15',
    slug: `btc-updown-15m-${slotUnix}`,
    question: 'Bitcoin Up or Down - 15m',
    yesTokenId: 'yes-token',
    noTokenId: 'no-token',
    active: true,
    closed: false,
    enableOrderBook: true,
    feesEnabled: true,
    endDate: new Date(now + 10 * 60_000).toISOString(),
    volume24hUsd: 1000,
    liquidityUsd: 1000,
    oracleAmbiguityScore: 0.05,
    ...overrides,
  };
}

function mockFetcher(m: MarketState | null): LatencyArbMarketFetcher {
  return { fetchMarketBySlug: async () => m };
}

function trackingFetcher(marketMap: Map<string, MarketState | null>): LatencyArbMarketFetcher & { slugs: string[] } {
  const slugs: string[] = [];
  return {
    slugs,
    fetchMarketBySlug: async (slug: string) => {
      slugs.push(slug);
      return marketMap.get(slug) ?? null;
    },
  };
}

describe('selectLatencyArbMarkets', () => {
  const config: LatencyArbMarketSelectionConfig = {
    asset: 'BTC',
    durationMinutes: 15,
    maxMarkets: 1,
    nowMs: now,
  };

  it('should fetch current 15m slot market by slug', async () => {
    const m = market();
    const selected = await selectLatencyArbMarkets(config, mockFetcher(m));

    expect(selected).toHaveLength(1);
    expect(selected[0].conditionId).toBe('cond-btc-15');
  });

  it('should reject inactive or closed markets', async () => {
    const closedMarket = market({ closed: true });
    const selected = await selectLatencyArbMarkets(config, mockFetcher(closedMarket));

    expect(selected).toHaveLength(0);
  });

  it('should reject markets without order book', async () => {
    const noBook = market({ enableOrderBook: false });
    const selected = await selectLatencyArbMarkets(config, mockFetcher(noBook));

    expect(selected).toHaveLength(0);
  });

  it('should reject markets without token IDs', async () => {
    const noTokens = market({ yesTokenId: '', noTokenId: '' });
    const selected = await selectLatencyArbMarkets(config, mockFetcher(noTokens));

    expect(selected).toHaveLength(0);
  });

  it('should return empty when maxMarkets is zero', async () => {
    const selected = await selectLatencyArbMarkets({ ...config, maxMarkets: 0 }, mockFetcher(market()));

    expect(selected).toHaveLength(0);
  });

  it('should return empty when fetcher returns null', async () => {
    const selected = await selectLatencyArbMarkets(config, mockFetcher(null));

    expect(selected).toHaveLength(0);
  });

  it('should try next slot when current slot returns null', async () => {
    const nextSlotUnix = slotUnix + 900;
    const nextSlug = `btc-updown-15m-${nextSlotUnix}`;
    const nextMarket = market({ slug: nextSlug, conditionId: 'next-slot' });

    const fetcher = trackingFetcher(new Map([
      [`btc-updown-15m-${slotUnix}`, null],
      [nextSlug, nextMarket],
    ]));

    const selected = await selectLatencyArbMarkets(config, fetcher);

    expect(selected).toHaveLength(1);
    expect(selected[0].conditionId).toBe('next-slot');
    expect(fetcher.slugs).toEqual([`btc-updown-15m-${slotUnix}`, nextSlug]);
  });

  it('should try current and next 2 slots before giving up', async () => {
    const fetcher = trackingFetcher(new Map());
    const selected = await selectLatencyArbMarkets(config, fetcher);

    expect(selected).toHaveLength(0);
    expect(fetcher.slugs).toHaveLength(3);
    expect(fetcher.slugs[0]).toBe(`btc-updown-15m-${slotUnix}`);
    expect(fetcher.slugs[1]).toBe(`btc-updown-15m-${slotUnix + 900}`);
    expect(fetcher.slugs[2]).toBe(`btc-updown-15m-${slotUnix + 1800}`);
  });
});

describe('buildCrypto15mSlug', () => {
  it('should generate correct slug format', () => {
    const slug = buildCrypto15mSlug('BTC', 1700000000000);
    expect(slug).toBe('btc-updown-15m-1700000000');
  });

  it('should lowercase asset', () => {
    expect(buildCrypto15mSlug('BTC', 1000000)).toBe('btc-updown-15m-1000');
    expect(buildCrypto15mSlug('ETH', 1000000)).toBe('eth-updown-15m-1000');
  });
});
