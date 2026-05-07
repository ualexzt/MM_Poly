import { StrategyRiskConfig, StrategyRiskManager } from '../../src/risk/strategy-risk-manager';
import { Position } from '../../src/accounting/paper-pnl-tracker';
import { BookState } from '../../src/types/book';

const config: StrategyRiskConfig = {
  softInventoryLimitPct: 50,
  reduceOnlyInventoryLimitPct: 70,
  hardInventoryLimitPct: 90,
  maxMarketExposureContracts: 100,
  concentrationWarningPct: 90,
  concentrationCriticalPctLive: 90,
};

function makePosition(overrides: Partial<Position>): Position {
  return {
    tokenId: 'token-yes',
    netSize: 0,
    avgCost: 0,
    realizedPnl: 0,
    totalBoughtUsd: 0,
    totalSoldUsd: 0,
    totalVolumeUsd: 0,
    ...overrides,
  };
}

function makeBook(overrides: Partial<BookState> = {}): BookState {
  return {
    conditionId: 'market-1',
    tokenId: 'token-yes',
    bids: [{ price: 0.55, size: 100, sizeUsd: 55 }],
    asks: [{ price: 0.56, size: 100, sizeUsd: 56 }],
    bestBid: 0.55,
    bestAsk: 0.56,
    bestBidSizeUsd: 100,
    bestAskSizeUsd: 100,
    midpoint: 0.555,
    spread: 0.01,
    spreadTicks: 1,
    depth1Usd: 200,
    depth3Usd: 200,
    tickSize: 0.01,
    minOrderSize: 1,
    lastUpdateMs: Date.now(),
    ...overrides,
  };
}

describe('StrategyRiskManager', () => {
  test('blocks SELL and allows BUY when short above reduce-only threshold', () => {
    const manager = new StrategyRiskManager(config);

    const decision = manager.evaluateMarket({
      mode: 'paper',
      conditionId: 'market-1',
      tokenId: 'token-yes',
      position: makePosition({ netSize: -80, avgCost: 0.62 }),
      book: makeBook(),
      currentFair: 0.555,
      primaryMarketQuoteSharePct: 50,
      hasActiveQuotes: true,
      isBookStale: false,
      killSwitchActive: false,
    });

    expect(decision.reduceOnly).toBe(true);
    expect(decision.allowBuy).toBe(true);
    expect(decision.allowSell).toBe(false);
    expect(decision.positionSide).toBe('SHORT');
    expect(decision.inventoryUsagePct).toBeCloseTo(80);
    expect(decision.reasons).toContain('reduce_only_short_inventory');
  });

  test('blocks BUY and allows SELL when long above reduce-only threshold', () => {
    const manager = new StrategyRiskManager(config);

    const decision = manager.evaluateMarket({
      mode: 'paper',
      conditionId: 'market-1',
      tokenId: 'token-yes',
      position: makePosition({ netSize: 75, avgCost: 0.40 }),
      book: makeBook(),
      currentFair: 0.45,
      primaryMarketQuoteSharePct: 50,
      hasActiveQuotes: true,
      isBookStale: false,
      killSwitchActive: false,
    });

    expect(decision.reduceOnly).toBe(true);
    expect(decision.allowBuy).toBe(false);
    expect(decision.allowSell).toBe(true);
    expect(decision.positionSide).toBe('LONG');
    expect(decision.reasons).toContain('reduce_only_long_inventory');
  });

  test('allows both sides below soft threshold', () => {
    const manager = new StrategyRiskManager(config);

    const decision = manager.evaluateMarket({
      mode: 'paper',
      conditionId: 'market-1',
      tokenId: 'token-yes',
      position: makePosition({ netSize: 20, avgCost: 0.40 }),
      book: makeBook(),
      currentFair: 0.45,
      primaryMarketQuoteSharePct: 50,
      hasActiveQuotes: true,
      isBookStale: false,
      killSwitchActive: false,
    });

    expect(decision.reduceOnly).toBe(false);
    expect(decision.allowBuy).toBe(true);
    expect(decision.allowSell).toBe(true);
    expect(decision.riskStatus).toBe('OK');
  });

  test('computes short fair pnl, exit pnl, and worst case to one', () => {
    const manager = new StrategyRiskManager(config);

    const decision = manager.evaluateMarket({
      mode: 'paper',
      conditionId: 'market-1',
      tokenId: 'token-yes',
      position: makePosition({ netSize: -10, avgCost: 0.62 }),
      book: makeBook({ bestAsk: 0.57 }),
      currentFair: 0.55,
      primaryMarketQuoteSharePct: 50,
      hasActiveQuotes: true,
      isBookStale: false,
      killSwitchActive: false,
    });

    expect(decision.fairUnrealizedPnl).toBeCloseTo(0.70);
    expect(decision.exitPnlAtBestBidAsk).toBeCloseTo(0.50);
    expect(decision.worstCaseLossToOne).toBeCloseTo(3.80);
    expect(decision.worstCaseLossToZero).toBeNull();
  });

  test('computes long fair pnl, exit pnl, and worst case to zero', () => {
    const manager = new StrategyRiskManager(config);

    const decision = manager.evaluateMarket({
      mode: 'paper',
      conditionId: 'market-1',
      tokenId: 'token-yes',
      position: makePosition({ netSize: 10, avgCost: 0.40 }),
      book: makeBook({ bestBid: 0.44 }),
      currentFair: 0.45,
      primaryMarketQuoteSharePct: 50,
      hasActiveQuotes: true,
      isBookStale: false,
      killSwitchActive: false,
    });

    expect(decision.fairUnrealizedPnl).toBeCloseTo(0.50);
    expect(decision.exitPnlAtBestBidAsk).toBeCloseTo(0.40);
    expect(decision.worstCaseLossToZero).toBeCloseTo(4.00);
    expect(decision.worstCaseLossToOne).toBeNull();
  });

  test('escalates concentration above warning threshold', () => {
    const manager = new StrategyRiskManager(config);

    const decision = manager.evaluateMarket({
      mode: 'paper',
      conditionId: 'market-1',
      tokenId: 'token-yes',
      position: makePosition({ netSize: 10, avgCost: 0.40 }),
      book: makeBook(),
      currentFair: 0.45,
      primaryMarketQuoteSharePct: 99.95,
      hasActiveQuotes: true,
      isBookStale: false,
      killSwitchActive: false,
    });

    expect(decision.riskStatus).toBe('WARNING');
    expect(decision.reasons).toContain('single_market_concentration_above_90_pct');
  });

  test('keeps exactly hard inventory threshold at warning', () => {
    const manager = new StrategyRiskManager(config);

    const decision = manager.evaluateMarket({
      mode: 'paper',
      conditionId: 'market-1',
      tokenId: 'token-yes',
      position: makePosition({ netSize: -90, avgCost: 0.62 }),
      book: makeBook(),
      currentFair: 0.55,
      primaryMarketQuoteSharePct: 50,
      hasActiveQuotes: true,
      isBookStale: false,
      killSwitchActive: false,
    });

    expect(decision.riskStatus).toBe('WARNING');
    expect(decision.reduceOnly).toBe(true);
    expect(decision.reasons).not.toContain('inventory_limit_above_90_pct');
  });

  test('escalates just above hard inventory threshold to critical', () => {
    const manager = new StrategyRiskManager(config);

    const decision = manager.evaluateMarket({
      mode: 'paper',
      conditionId: 'market-1',
      tokenId: 'token-yes',
      position: makePosition({ netSize: -90.01, avgCost: 0.62 }),
      book: makeBook(),
      currentFair: 0.55,
      primaryMarketQuoteSharePct: 50,
      hasActiveQuotes: true,
      isBookStale: false,
      killSwitchActive: false,
    });

    expect(decision.riskStatus).toBe('CRITICAL');
    expect(decision.reasons).toContain('inventory_limit_above_90_pct');
  });

  test('escalates hard inventory breach to critical', () => {
    const manager = new StrategyRiskManager(config);

    const decision = manager.evaluateMarket({
      mode: 'paper',
      conditionId: 'market-1',
      tokenId: 'token-yes',
      position: makePosition({ netSize: -95, avgCost: 0.62 }),
      book: makeBook(),
      currentFair: 0.55,
      primaryMarketQuoteSharePct: 50,
      hasActiveQuotes: true,
      isBookStale: false,
      killSwitchActive: false,
    });

    expect(decision.riskStatus).toBe('CRITICAL');
    expect(decision.reasons).toContain('inventory_limit_above_90_pct');
  });

  test('blocks both sides and escalates stale book with active quotes to critical', () => {
    const manager = new StrategyRiskManager(config);

    const decision = manager.evaluateMarket({
      mode: 'paper',
      conditionId: 'market-1',
      tokenId: 'token-yes',
      position: makePosition({ netSize: 20, avgCost: 0.40 }),
      book: makeBook(),
      currentFair: 0.45,
      primaryMarketQuoteSharePct: 50,
      hasActiveQuotes: true,
      isBookStale: true,
      killSwitchActive: false,
    });

    expect(decision.allowBuy).toBe(false);
    expect(decision.allowSell).toBe(false);
    expect(decision.riskStatus).toBe('CRITICAL');
    expect(decision.reasons).toContain('stale_book_with_active_quotes');
  });

  test('blocks both sides and escalates kill switch to critical', () => {
    const manager = new StrategyRiskManager(config);

    const decision = manager.evaluateMarket({
      mode: 'paper',
      conditionId: 'market-1',
      tokenId: 'token-yes',
      position: makePosition({ netSize: 20, avgCost: 0.40 }),
      book: makeBook(),
      currentFair: 0.45,
      primaryMarketQuoteSharePct: 50,
      hasActiveQuotes: true,
      isBookStale: false,
      killSwitchActive: true,
    });

    expect(decision.allowBuy).toBe(false);
    expect(decision.allowSell).toBe(false);
    expect(decision.riskStatus).toBe('CRITICAL');
    expect(decision.reasons).toContain('kill_switch_active');
  });

  test('escalates small live concentration above critical threshold to critical', () => {
    const manager = new StrategyRiskManager(config);

    const decision = manager.evaluateMarket({
      mode: 'small_live',
      conditionId: 'market-1',
      tokenId: 'token-yes',
      position: makePosition({ netSize: 10, avgCost: 0.40 }),
      book: makeBook(),
      currentFair: 0.45,
      primaryMarketQuoteSharePct: 90.01,
      hasActiveQuotes: true,
      isBookStale: false,
      killSwitchActive: false,
    });

    expect(decision.riskStatus).toBe('CRITICAL');
    expect(decision.reasons).toContain('live_single_market_concentration_critical');
  });
});
