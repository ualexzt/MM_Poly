import { FifteenMinMarketScanner } from '../../src/data/fifteen-min-scanner';

describe('FifteenMinMarketScanner', () => {
  describe('generateSlugs', () => {
    it('defaults to original Gabagool BTC then ETH 15-minute markets only', () => {
      const scanner = new FifteenMinMarketScanner({
        gammaBaseUrl: 'https://gamma-api.polymarket.com',
        nowMs: () => 1_780_390_800_000,
      });

      const slugs = scanner.generateSlugs();

      expect(slugs).toEqual([
        'btc-updown-15m-1780390800',
        'btc-updown-15m-1780391700',
        'eth-updown-15m-1780390800',
        'eth-updown-15m-1780391700',
      ]);
    });

    it('generates timestamps rounded to 15-minute intervals using injected time', () => {
      const scanner = new FifteenMinMarketScanner({
        gammaBaseUrl: 'https://gamma-api.polymarket.com',
        coins: ['btc'],
        nowMs: () => 1_780_391_234_000,
      });

      const slugs = scanner.generateSlugs();
      const timestamps = slugs.map(s => parseInt(s.split('-').pop()!));

      expect(timestamps).toEqual([1_780_390_800, 1_780_391_700]);
      expect(timestamps.every(t => t % 900 === 0)).toBe(true);
    });
  });

  describe('fetchMarkets', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('skips a market inside settlement buffer and selects next interval', async () => {
      const fetchMock = jest.spyOn(global, 'fetch' as any).mockImplementation(async (...args: unknown[]) => {
        const url = String(args[0]);
        const slug = url.split('slug=')[1];
        return {
          ok: true,
          json: async () => [{
            title: slug,
            markets: [{
              id: `${slug}-id`,
              conditionId: `${slug}-condition`,
              question: slug,
              clobTokenIds: JSON.stringify([`${slug}-yes`, `${slug}-no`]),
              volume24hr: '100',
              liquidity: '50',
            }],
          }],
        } as any;
      });

      const scanner = new FifteenMinMarketScanner({
        gammaBaseUrl: 'https://gamma-api.polymarket.com',
        nowMs: () => 1_780_391_650_000, // 50s before 1780391700 expiry
        settlementBufferSeconds: 120,
      });

      const markets = await scanner.fetchMarkets();

      expect(markets).toHaveLength(1);
      expect(markets[0].slug).toBe('btc-updown-15m-1780391700');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('returns only the first suitable market, preserving original one-market-at-a-time behavior', async () => {
      const fetchMock = jest.spyOn(global, 'fetch' as any).mockImplementation(async (...args: unknown[]) => {
        const url = String(args[0]);
        const slug = url.split('slug=')[1];
        if (slug === 'btc-updown-15m-1780390800' || slug === 'eth-updown-15m-1780390800') {
          return { ok: true, json: async () => [] } as any;
        }
        return {
          ok: true,
          json: async () => [{
            title: slug,
            markets: [{
              id: `${slug}-id`,
              conditionId: `${slug}-condition`,
              question: slug,
              clobTokenIds: JSON.stringify([`${slug}-yes`, `${slug}-no`]),
              volume24hr: '100',
              liquidity: '50',
            }],
          }],
        } as any;
      });

      const scanner = new FifteenMinMarketScanner({
        gammaBaseUrl: 'https://gamma-api.polymarket.com',
        nowMs: () => 1_780_390_800_000,
      });

      const markets = await scanner.fetchMarkets();

      expect(markets).toHaveLength(1);
      expect(markets[0].slug).toBe('btc-updown-15m-1780391700');
      expect(markets[0].yesTokenId).toBe('btc-updown-15m-1780391700-yes');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
