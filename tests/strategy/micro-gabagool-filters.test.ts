import { passesMarketFilters, FilterInputs } from '../../src/strategy/micro-gabagool-filters';

describe('passesMarketFilters', () => {
  function idealInputs(overrides?: Partial<FilterInputs>): FilterInputs {
    return {
      bestBid: 0.45,
      bestAsk: 0.48,
      bestBidSizeUsd: 50,
      bestAskSizeUsd: 50,
      timeToSettlementMin: 120,
      hasRecentTrades: true,
      isInCooldown: false,
      hasActivePosition: false,
      hasActiveOrder: false,
      minSpread: 0.02,
      maxSpread: 0.05,
      minBid: 0.08,
      maxAsk: 0.92,
      minTimeToSettlementMinutes: 15,
      minTopOfBookSizeUsd: 10,
      ...overrides,
    };
  }

  it('should pass ideal market', () => {
    expect(passesMarketFilters(idealInputs()).pass).toBe(true);
  });

  it('should reject spread too narrow', () => {
    const result = passesMarketFilters(idealInputs({ bestAsk: 0.46 }));
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('spread_too_narrow');
  });

  it('should reject spread too wide', () => {
    const result = passesMarketFilters(idealInputs({ bestAsk: 0.52 }));
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('spread_too_wide');
  });

  it('should reject bid too low', () => {
    const result = passesMarketFilters(idealInputs({ bestBid: 0.05, bestAsk: 0.07 }));
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('bid_too_low');
  });

  it('should reject ask too high', () => {
    const result = passesMarketFilters(idealInputs({ bestBid: 0.90, bestAsk: 0.95 }));
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('ask_too_high');
  });

  it('should reject too close to settlement', () => {
    const result = passesMarketFilters(idealInputs({ timeToSettlementMin: 10 }));
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('too_close_to_settlement');
  });

  it('should reject thin bid depth', () => {
    const result = passesMarketFilters(idealInputs({ bestBidSizeUsd: 5 }));
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('bid_depth_too_thin');
  });

  it('should reject thin ask depth', () => {
    const result = passesMarketFilters(idealInputs({ bestAskSizeUsd: 5 }));
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('ask_depth_too_thin');
  });

  it('should reject no recent trades', () => {
    const result = passesMarketFilters(idealInputs({ hasRecentTrades: false }));
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('no_recent_trades');
  });

  it('should reject market in cooldown', () => {
    const result = passesMarketFilters(idealInputs({ isInCooldown: true }));
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('market_in_cooldown');
  });

  it('should reject if already has position', () => {
    const result = passesMarketFilters(idealInputs({ hasActivePosition: true }));
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('already_has_position');
  });

  it('should reject if already has active order', () => {
    const result = passesMarketFilters(idealInputs({ hasActiveOrder: true }));
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('already_has_active_order');
  });

  it('should accept spread exactly at min', () => {
    const result = passesMarketFilters(idealInputs({ bestBid: 0.45, bestAsk: 0.47 + 0.0001 }));
    expect(result.pass).toBe(true);
  });

  it('should accept spread exactly at max', () => {
    const result = passesMarketFilters(idealInputs({ bestBid: 0.45, bestAsk: 0.50 }));
    expect(result.pass).toBe(true);
  });

  it('should accept settlement exactly at min', () => {
    const result = passesMarketFilters(idealInputs({ timeToSettlementMin: 15 }));
    expect(result.pass).toBe(true);
  });

  it('should accept depth exactly at min', () => {
    const result = passesMarketFilters(idealInputs({ bestBidSizeUsd: 10, bestAskSizeUsd: 10 }));
    expect(result.pass).toBe(true);
  });
});
