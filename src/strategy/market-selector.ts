import { MarketState } from '../types/market';
import { MarketFilterConfig } from '../types/config';

export function filterEligibleMarkets(markets: MarketState[], config: MarketFilterConfig): MarketState[] {
  return markets.filter(m => {
    if (config.active && !m.active) return false;
    if (config.closed && !m.closed) return false;
    if (!config.closed && m.closed) return false;
    if (config.enableOrderBook && !m.enableOrderBook) return false;
    if (config.feesEnabled && !m.feesEnabled) return false;
    if (m.volume24hUsd < config.minVolume24hUsd) return false;
    if (m.liquidityUsd < config.minLiquidityUsd) return false;
    if (m.oracleAmbiguityScore > config.maxOracleAmbiguityScore) return false;
    return true;
  });
}
