import { MarketState } from '../types/market';
import { LatencyArbMarketFetcher, buildCrypto15mSlug } from './latency-arb-market-selector';

/**
 * Fetches BTC 15m Up/Down markets from Gamma API by slug.
 * These markets are ephemeral — created every 15 minutes and resolved after.
 * Slug format: {asset}-updown-15m-{unix_timestamp}
 */
export class GammaSlugMarketFetcher implements LatencyArbMarketFetcher {
  private readonly baseUrl: string;

  constructor(baseUrl = 'https://gamma-api.polymarket.com') {
    this.baseUrl = baseUrl;
  }

  async fetchMarketBySlug(slug: string): Promise<MarketState | null> {
    const url = `${this.baseUrl}/markets/slug/${slug}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });

    if (!res.ok) return null;

    const data = await res.json() as Record<string, unknown>;
    if (!data || !data.conditionId) return null;

    let tokenIds: string[] = [];
    const raw = data.clobTokenIds;
    if (typeof raw === 'string') {
      try { tokenIds = JSON.parse(raw); } catch { return null; }
    } else if (Array.isArray(raw)) {
      tokenIds = raw;
    }

    if (tokenIds.length < 2) return null;

    return {
      conditionId: String(data.conditionId ?? ''),
      slug: slug,
      question: String(data.question ?? ''),
      yesTokenId: tokenIds[0] ?? '',
      noTokenId: tokenIds[1] ?? '',
      active: data.active === true,
      closed: data.closed === true,
      enableOrderBook: tokenIds.length >= 2,
      feesEnabled: true,
      endDate: String(data.endDate ?? ''),
      volume24hUsd: Number(data.volume24hr ?? 0),
      liquidityUsd: Number(data.liquidityClob ?? 0),
      oracleAmbiguityScore: 0.05,
    };
  }
}
