import { MarketState } from '../types/market';

const COINS = ['btc', 'eth'];
const INTERVAL_SECONDS = 900; // 15 minutes
const DEFAULT_SETTLEMENT_BUFFER_SECONDS = 120;

export interface FifteenMinMarketScannerConfig {
  gammaBaseUrl: string;
  coins?: string[];
  nowMs?: () => number;
  settlementBufferSeconds?: number;
}

export class FifteenMinMarketScanner {
  private gammaBaseUrl: string;
  private coins: string[];
  private nowMs: () => number;
  private settlementBufferSeconds: number;

  constructor(config: FifteenMinMarketScannerConfig) {
    this.gammaBaseUrl = config.gammaBaseUrl;
    this.coins = config.coins || COINS;
    this.nowMs = config.nowMs || (() => Date.now());
    this.settlementBufferSeconds = config.settlementBufferSeconds ?? DEFAULT_SETTLEMENT_BUFFER_SECONDS;
  }

  /**
   * Original Gabagool universe: BTC first, then ETH 15-minute up/down markets.
   * Generate current interval and the next interval for each asset.
   */
  generateSlugs(): string[] {
    const now = Math.floor(this.nowMs() / 1000);
    const currentInterval = Math.floor(now / INTERVAL_SECONDS) * INTERVAL_SECONDS;
    const slugs: string[] = [];

    for (const coin of this.coins) {
      slugs.push(`${coin}-updown-15m-${currentInterval}`);
      slugs.push(`${coin}-updown-15m-${currentInterval + INTERVAL_SECONDS}`);
    }

    return slugs;
  }

  /**
   * Fetch the first available 15-minute market, preserving original one-market-at-a-time behavior.
   */
  async fetchMarkets(): Promise<MarketState[]> {
    for (const slug of this.generateSlugs()) {
      if (this.isWithinSettlementBuffer(slug)) continue;
      const market = await this.fetchMarketBySlug(slug);
      if (market) return [market];
    }

    return [];
  }

  private isWithinSettlementBuffer(slug: string): boolean {
    const startTimestamp = Number(slug.split('-').pop());
    if (!Number.isFinite(startTimestamp)) return true;

    const endMs = (startTimestamp + INTERVAL_SECONDS) * 1000;
    return endMs - this.nowMs() <= this.settlementBufferSeconds * 1000;
  }

  private async fetchMarketBySlug(slug: string): Promise<MarketState | null> {
    try {
      const resp = await fetch(`${this.gammaBaseUrl}/events?slug=${slug}`);
      if (!resp.ok) return null;

      const data = await resp.json();
      if (!data || data.length === 0) return null;

      const event = data[0];
      if (!event.markets || event.markets.length === 0) return null;

      const m = event.markets[0];
      const tokenIds = m.clobTokenIds ? JSON.parse(m.clobTokenIds) : [];
      if (tokenIds.length < 2) return null;

      const startTimestamp = Number(slug.split('-').pop());
      const endDate = Number.isFinite(startTimestamp)
        ? new Date((startTimestamp + INTERVAL_SECONDS) * 1000).toISOString()
        : undefined;

      return {
        conditionId: m.conditionId || m.id,
        slug,
        question: m.question || event.title || slug,
        yesTokenId: tokenIds[0],
        noTokenId: tokenIds[1],
        active: m.active ?? true,
        closed: m.closed ?? false,
        enableOrderBook: m.enableOrderBook ?? true,
        feesEnabled: m.feesEnabled ?? true,
        endDate,
        volume24hUsd: parseFloat(m.volume24hr || '0'),
        liquidityUsd: parseFloat(m.liquidity || '0'),
        oracleAmbiguityScore: 0,
        feeRate: 0,
      };
    } catch {
      return null;
    }
  }
}
