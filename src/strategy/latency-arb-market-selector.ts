import { MarketState } from '../types/market';

export interface LatencyArbMarketSelectionConfig {
  asset: 'BTC';
  durationMinutes: number;
  maxMarkets: number;
  nowMs: number;
}

function textOf(market: MarketState): string {
  return `${market.slug ?? ''} ${market.question ?? ''}`.toLowerCase();
}

function isBtcMarket(market: MarketState): boolean {
  const text = textOf(market);
  return text.includes('btc') || text.includes('bitcoin');
}

function isUpDownMarket(market: MarketState): boolean {
  const text = textOf(market);
  return (text.includes('up') && text.includes('down')) || text.includes('higher or lower');
}

function isDurationMarket(market: MarketState, durationMinutes: number): boolean {
  const text = textOf(market);
  const durationPatterns = [
    `${durationMinutes}m`,
    `${durationMinutes} m`,
    `${durationMinutes}-minute`,
    `${durationMinutes} minute`,
    `${durationMinutes}min`,
  ];
  return durationPatterns.some((pattern) => text.includes(pattern));
}

function endTimeMs(market: MarketState): number {
  if (!market.endDate) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(market.endDate);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

export function selectLatencyArbMarkets(
  markets: MarketState[],
  config: LatencyArbMarketSelectionConfig
): MarketState[] {
  return markets
    .filter((market) => market.active === true)
    .filter((market) => market.closed === false)
    .filter((market) => market.enableOrderBook === true)
    .filter((market) => market.yesTokenId.length > 0 && market.noTokenId.length > 0)
    .filter((market) => isBtcMarket(market))
    .filter((market) => isUpDownMarket(market))
    .filter((market) => isDurationMarket(market, config.durationMinutes))
    .filter((market) => endTimeMs(market) > config.nowMs)
    .sort((a, b) => endTimeMs(a) - endTimeMs(b))
    .slice(0, config.maxMarkets);
}
