export interface FilterInputs {
  bestBid: number;
  bestAsk: number;
  bestBidSizeUsd: number;
  bestAskSizeUsd: number;
  timeToSettlementMin: number;
  hasRecentTrades: boolean;
  isInCooldown: boolean;
  hasActivePosition: boolean;
  hasActiveOrder: boolean;
  minSpread: number;
  maxSpread: number;
  minBid: number;
  maxAsk: number;
  minTimeToSettlementMinutes: number;
  minTopOfBookSizeUsd: number;
}

export interface FilterResult {
  pass: boolean;
  reason?: string;
}

export function passesMarketFilters(inputs: FilterInputs): FilterResult {
  const spread = inputs.bestAsk - inputs.bestBid;

  if (spread < inputs.minSpread) {
    return { pass: false, reason: 'spread_too_narrow' };
  }
  if (spread > inputs.maxSpread) {
    return { pass: false, reason: 'spread_too_wide' };
  }
  if (inputs.bestBid < inputs.minBid) {
    return { pass: false, reason: 'bid_too_low' };
  }
  if (inputs.bestAsk > inputs.maxAsk) {
    return { pass: false, reason: 'ask_too_high' };
  }
  if (inputs.timeToSettlementMin < inputs.minTimeToSettlementMinutes) {
    return { pass: false, reason: 'too_close_to_settlement' };
  }
  if (inputs.bestBidSizeUsd < inputs.minTopOfBookSizeUsd) {
    return { pass: false, reason: 'bid_depth_too_thin' };
  }
  if (inputs.bestAskSizeUsd < inputs.minTopOfBookSizeUsd) {
    return { pass: false, reason: 'ask_depth_too_thin' };
  }
  if (!inputs.hasRecentTrades) {
    return { pass: false, reason: 'no_recent_trades' };
  }
  if (inputs.isInCooldown) {
    return { pass: false, reason: 'market_in_cooldown' };
  }
  if (inputs.hasActivePosition) {
    return { pass: false, reason: 'already_has_position' };
  }
  if (inputs.hasActiveOrder) {
    return { pass: false, reason: 'already_has_active_order' };
  }

  return { pass: true };
}
