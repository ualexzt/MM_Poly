import { MarketState } from '../types/market';

export interface LatencyArbMarketSelectionConfig {
  asset: 'BTC';
  durationMinutes: number;
  maxMarkets: number;
  nowMs: number;
}

export interface LatencyArbMarketFetcher {
  fetchMarketBySlug(slug: string): Promise<MarketState | null>;
}

function computeSlotStartMs(nowMs: number, durationMinutes: number): number {
  const intervalMs = durationMinutes * 60 * 1000;
  return Math.floor(nowMs / intervalMs) * intervalMs;
}

export function buildCrypto15mSlug(asset: string, slotStartMs: number): string {
  const slotUnix = Math.floor(slotStartMs / 1000);
  return `${asset.toLowerCase()}-updown-15m-${slotUnix}`;
}

function isValidActiveMarket(market: MarketState, nowMs: number): boolean {
  return (
    market.active === true &&
    market.closed === false &&
    market.enableOrderBook === true &&
    market.yesTokenId.length > 0 &&
    market.noTokenId.length > 0
  );
}

export async function selectLatencyArbMarkets(
  config: LatencyArbMarketSelectionConfig,
  fetcher: LatencyArbMarketFetcher
): Promise<MarketState[]> {
  if (config.maxMarkets <= 0) return [];

  const intervalMs = config.durationMinutes * 60 * 1000;
  const slotStartMs = computeSlotStartMs(config.nowMs, config.durationMinutes);

  // Try current slot and next 2 slots
  for (let i = 0; i < 3; i++) {
    const candidateSlotMs = slotStartMs + i * intervalMs;
    const slug = buildCrypto15mSlug(config.asset, candidateSlotMs);

    try {
      const market = await fetcher.fetchMarketBySlug(slug);
      if (market && isValidActiveMarket(market, config.nowMs)) {
        return [market];
      }
    } catch {
      // Slug not found or API error — try next slot
    }
  }

  return [];
}
