import { FifteenMinMarketScanner } from '../../src/data/fifteen-min-scanner';

describe('FifteenMinMarketScanner', () => {
  describe('generateSlugs', () => {
    it('generates slugs for all coins', () => {
      const scanner = new FifteenMinMarketScanner({
        gammaBaseUrl: 'https://gamma-api.polymarket.com',
        coins: ['btc', 'eth'],
      });

      const slugs = scanner.generateSlugs();

      expect(slugs.length).toBe(4); // 2 coins * 2 intervals
      expect(slugs.every(s => s.includes('-updown-15m-'))).toBe(true);
      expect(slugs.some(s => s.startsWith('btc-'))).toBe(true);
      expect(slugs.some(s => s.startsWith('eth-'))).toBe(true);
    });

    it('generates timestamps rounded to 15-minute intervals', () => {
      const scanner = new FifteenMinMarketScanner({
        gammaBaseUrl: 'https://gamma-api.polymarket.com',
        coins: ['btc'],
      });

      const slugs = scanner.generateSlugs();
      const timestamps = slugs.map(s => parseInt(s.split('-').pop()!));

      // All timestamps should be divisible by 900
      expect(timestamps.every(t => t % 900 === 0)).toBe(true);
    });

    it('generates current and next interval', () => {
      const scanner = new FifteenMinMarketScanner({
        gammaBaseUrl: 'https://gamma-api.polymarket.com',
        coins: ['btc'],
      });

      const slugs = scanner.generateSlugs();
      const timestamps = slugs.map(s => parseInt(s.split('-').pop()!)).sort((a, b) => a - b);

      expect(timestamps.length).toBe(2);
      expect(timestamps[1] - timestamps[0]).toBe(900);
    });

    it('defaults to btc, eth, sol, xrp', () => {
      const scanner = new FifteenMinMarketScanner({
        gammaBaseUrl: 'https://gamma-api.polymarket.com',
      });

      const slugs = scanner.generateSlugs();

      expect(slugs.length).toBe(8); // 4 coins * 2 intervals
    });
  });
});
