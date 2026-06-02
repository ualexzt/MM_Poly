import { MarketState } from '../types/market';

const COINS = ['btc', 'eth', 'sol', 'xrp'];
const INTERVAL_SECONDS = 900; // 15 minutes

export interface FifteenMinMarketScannerConfig {
  gammaBaseUrl: string;
  coins?: string[];
}

export class FifteenMinMarketScanner {
  private gammaBaseUrl: string;
  private coins: string[];

  constructor(config: FifteenMinMarketScannerConfig) {
    this.gammaBaseUrl = config.gammaBaseUrl;
    this.coins = config.coins || COINS;
  }

  /**
   * Generate current and upcoming 15-minute market slugs.
   * Returns slugs for current interval and next interval.
   */
  generateSlugs(): string[] {
    const now = Math.floor(Date.now() / 1000);
    const currentInterval = Math.floor(now / INTERVAL_SECONDS) * INTERVAL_SECONDS;
    const slugs: string[] = [];

    for (const coin of this.coins) {
      // Current interval
      slugs.push(`${coin}-updown-15m-${currentInterval}`);
      // Next interval (upcoming)
      slugs.push(`${coin}-updown-15m-${currentInterval + INTERVAL_SECONDS}`);
    }

    return slugs;
  }

  /**
   * Fetch all active 15-minute markets.
   */
  async fetchMarkets(): Promise<MarketState[]> {
    const slugs = this.generateSlugs();
    const markets: MarketState[] = [];

    const fetches = slugs.map(async (slug) => {
      try {
        const resp = await fetch(`${this.gammaBaseUrl}/events?slug=${slug}`);
        if (!resp.ok) return;

        const data = await resp.json();
        if (!data || data.length === 0) return;

        const event = data[0];
        if (!event.markets || event.markets.length === 0) return;

        for (const m of event.markets) {
          const tokenIds = m.clobTokenIds ? JSON.parse(m.clobTokenIds) : [];
          if (tokenIds.length < 2) continue;

          markets.push({
            conditionId: m.conditionId || m.id,
            slug: slug,
            question: m.question || event.title || slug,
            yesTokenId: tokenIds[0],
            noTokenId: tokenIds[1],
            active: true,
            closed: false,
            enableOrderBook: true,
            feesEnabled: true,
            volume24hUsd: parseFloat(m.volume24hr || '0'),
            liquidityUsd: parseFloat(m.liquidity || '0'),
            oracleAmbiguityScore: 0,
            feeRate: 0,
          });
        }
      } catch {
        // skip failed fetches
      }
    });

    await Promise.all(fetches);
    return markets;
  }
}
