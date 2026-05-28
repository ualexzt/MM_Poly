import { StrategyRiskConfig, StrategyRiskManager } from '../../src/risk/strategy-risk-manager';
import { Position } from '../../src/accounting/paper-pnl-tracker';
import { BookState } from '../../src/types/book';

const config: StrategyRiskConfig = {
  softInventoryLimitPct: 25,
  reduceOnlyLimitPct: 70,
  hardInventoryLimitPct: 90,
  maxMarketExposureUsd: 50, // previously 100 contracts at ~$0.5
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
    expect(decision.inventoryUsagePct).toBeCloseTo(88.8);
    expect(decision.reasons).toContain('reduce_only_short_inventory');
  });

  test('blocks BUY and allows SELL when long above reduce-only threshold', () => {
    const manager = new StrategyRiskManager(config);

    const decision = manager.evaluateMarket({
      mode: 'paper',
      conditionId: 'market-1',
      tokenId: 'token-yes',
      position: makePosition({ netSize: 80, avgCost: 0.40 }),
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
    expect(decision.reasons).toContain('single_market_concentration_warning');
  });

  test('keeps exactly hard inventory threshold at warning', () => {
    const manager = new StrategyRiskManager(config);

    const decision = manager.evaluateMarket({
      mode: 'paper',
      conditionId: 'market-1',
      tokenId: 'token-yes',
      position: makePosition({ netSize: -90, avgCost: 0.62 }),
      book: makeBook(),
      currentFair: 0.50,
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
      position: makePosition({ netSize: -91, avgCost: 0.62 }),
      book: makeBook(),
      currentFair: 0.50,
      primaryMarketQuoteSharePct: 50,
      hasActiveQuotes: true,
      isBookStale: false,
      killSwitchActive: false,
    });

    expect(decision.riskStatus).toBe('CRITICAL');
    expect(decision.reasons).toContain('inventory_hard_limit_exceeded');
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
    expect(decision.reasons).toContain('inventory_hard_limit_exceeded');
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

  test('uses small_live throttle profile reduce-only threshold when configured', () => {
    const manager = new StrategyRiskManager({
      ...config,
      reduceOnlyLimitPct: 70,
      throttleProfiles: {
        paper: {
          reduceOnlyThresholdPct: 50,
          tiers: [],
        },
        small_live: {
          reduceOnlyThresholdPct: 45,
          tiers: [],
        },
      },
    });

    const decision = manager.evaluateMarket({
      mode: 'small_live',
      conditionId: 'market-1',
      tokenId: 'token-yes',
      position: makePosition({ netSize: 50, avgCost: 0.40 }),
      book: makeBook(),
      currentFair: 0.45,
      primaryMarketQuoteSharePct: 50,
      hasActiveQuotes: true,
      isBookStale: false,
      killSwitchActive: false,
    });

    expect(decision.inventoryUsagePct).toBeCloseTo(45);
    expect(decision.reduceOnly).toBe(true);
    expect(decision.allowBuy).toBe(false);
    expect(decision.allowSell).toBe(true);
    expect(decision.riskStatus).toBe('WARNING');
    expect(decision.reasons).toContain('reduce_only_long_inventory');
  });

  test('warns when an open short has negative executable exit despite low inventory usage', () => {
    const manager = new StrategyRiskManager({
      ...config,
      maxMarketExposureUsd: 10,
    });

    const decision = manager.evaluateMarket({
      mode: 'paper',
      conditionId: 'market-1',
      tokenId: 'token-yes',
      position: makePosition({ netSize: -2, avgCost: 0.65 }),
      book: makeBook({ bestBid: 0.01, bestAsk: 0.99, spread: 0.98, spreadTicks: 98 }),
      currentFair: 0.2555,
      primaryMarketQuoteSharePct: 50,
      hasActiveQuotes: true,
      isBookStale: false,
      killSwitchActive: false,
    });

    expect(decision.inventoryUsagePct).toBeCloseTo(5.11);
    expect(decision.exitPnlAtBestBidAsk).toBeCloseTo(-0.68);
    expect(decision.riskStatus).toBe('WARNING');
    expect(decision.reasons).toContain('negative_executable_exit');
    expect(decision.reasons).toContain('wide_book_spread');
    expect(decision.reduceOnly).toBe(false);
    expect(decision.allowBuy).toBe(true);
    expect(decision.allowSell).toBe(true);
  });

  test('small_live blocks inventory-increasing BUY for long position on any negative executable exit', () => {
    const manager = new StrategyRiskManager({
      ...config,
      negativeExitWarningUsd: 0,
      negativeExitCriticalUsd: -0.15,
    });

    const decision = manager.evaluateMarket({
      mode: 'small_live',
      conditionId: 'market-1',
      tokenId: 'token-yes',
      position: makePosition({ netSize: 2, avgCost: 0.58 }),
      book: makeBook({ bestBid: 0.55, bestAsk: 0.56 }),
      currentFair: 0.57,
      primaryMarketQuoteSharePct: 10,
      hasActiveQuotes: true,
      isBookStale: false,
      killSwitchActive: false,
    });

    expect(decision.exitPnlAtBestBidAsk).toBeCloseTo(-0.06);
    expect(decision.reasons).toContain('negative_executable_exit');
    expect(decision.allowBuy).toBe(false);
    expect(decision.allowSell).toBe(true);
    expect(decision.riskStatus).toBe('WARNING');
  });

  test('small_live escalates severe negative executable exit at fifteen cents', () => {
    const manager = new StrategyRiskManager({
      ...config,
      negativeExitWarningUsd: 0,
      negativeExitCriticalUsd: -0.15,
    });

    const decision = manager.evaluateMarket({
      mode: 'small_live',
      conditionId: 'market-1',
      tokenId: 'token-yes',
      position: makePosition({ netSize: -2, avgCost: 0.55 }),
      book: makeBook({ bestBid: 0.61, bestAsk: 0.64 }),
      currentFair: 0.60,
      primaryMarketQuoteSharePct: 10,
      hasActiveQuotes: true,
      isBookStale: false,
      killSwitchActive: false,
    });

    expect(decision.exitPnlAtBestBidAsk).toBeCloseTo(-0.18);
    expect(decision.reasons).toContain('severe_negative_executable_exit');
    expect(decision.allowSell).toBe(false);
    expect(decision.allowBuy).toBe(true);
    expect(decision.reduceOnly).toBe(true);
    expect(decision.riskStatus).toBe('CRITICAL');
  });

  test('blocks both sides and warns on crossed book', () => {
    const manager = new StrategyRiskManager(config);

    const decision = manager.evaluateMarket({
      mode: 'paper',
      conditionId: 'market-1',
      tokenId: 'token-yes',
      position: makePosition({ netSize: 1, avgCost: 0.50 }),
      book: makeBook({ bestBid: 0.60, bestAsk: 0.59, spread: -0.01, spreadTicks: -1 }),
      currentFair: 0.55,
      primaryMarketQuoteSharePct: 50,
      hasActiveQuotes: true,
      isBookStale: false,
      killSwitchActive: false,
    });

    expect(decision.riskStatus).toBe('WARNING');
    expect(decision.reasons).toContain('invalid_book_crossed_or_missing');
    expect(decision.allowBuy).toBe(false);
    expect(decision.allowSell).toBe(false);
  });

  test('escalates severe negative executable exit to critical reduce-only behavior', () => {
    const manager = new StrategyRiskManager(config);

    const decision = manager.evaluateMarket({
      mode: 'paper',
      conditionId: 'market-1',
      tokenId: 'token-yes',
      position: makePosition({ netSize: -4, avgCost: 0.50 }),
      book: makeBook({ bestBid: 0.01, bestAsk: 0.90, spread: 0.89, spreadTicks: 89 }),
      currentFair: 0.25,
      primaryMarketQuoteSharePct: 50,
      hasActiveQuotes: true,
      isBookStale: false,
      killSwitchActive: false,
    });

    expect(decision.exitPnlAtBestBidAsk).toBeCloseTo(-1.60);
    expect(decision.riskStatus).toBe('CRITICAL');
    expect(decision.reasons).toContain('severe_negative_executable_exit');
    expect(decision.reduceOnly).toBe(true);
    expect(decision.allowBuy).toBe(true);
    expect(decision.allowSell).toBe(false);
  });

  test('applies light throttle when exit is mildly negative (warning zone shallow)', () => {
    const manager = new StrategyRiskManager(config);
    // exit = 4 * (0.55 - 0.60) = -$0.20; depth = 0.20 < 0.5 → light throttle
    const decision = manager.evaluateMarket({
      mode: 'paper',
      conditionId: 'market-1',
      tokenId: 'token-yes',
      position: makePosition({ netSize: -4, avgCost: 0.55 }),
      book: makeBook({ bestBid: 0.59, bestAsk: 0.60, spread: 0.01, spreadTicks: 1 }),
      currentFair: 0.595,
      primaryMarketQuoteSharePct: 50,
      hasActiveQuotes: true,
      isBookStale: false,
      killSwitchActive: false,
    });

    expect(decision.exitPnlAtBestBidAsk).toBeCloseTo(-0.20);
    expect(decision.riskStatus).toBe('WARNING');
    expect(decision.reasons).toContain('negative_executable_exit');
    expect(decision.reduceOnly).toBe(false);
    expect(decision.negativeExitThrottle).toEqual({ sizeMultiplier: 0.5, extraHalfSpreadCents: 0.5 });
  });

  test('applies heavy throttle when exit is deeply negative (warning zone deep)', () => {
    const manager = new StrategyRiskManager(config);
    // exit = 16 * (0.55 - 0.60) = -$0.80; depth = 0.80 >= 0.5 → heavy throttle
    const decision = manager.evaluateMarket({
      mode: 'paper',
      conditionId: 'market-1',
      tokenId: 'token-yes',
      position: makePosition({ netSize: -16, avgCost: 0.55 }),
      book: makeBook({ bestBid: 0.59, bestAsk: 0.60, spread: 0.01, spreadTicks: 1 }),
      currentFair: 0.595,
      primaryMarketQuoteSharePct: 50,
      hasActiveQuotes: true,
      isBookStale: false,
      killSwitchActive: false,
    });

    expect(decision.exitPnlAtBestBidAsk).toBeCloseTo(-0.80);
    expect(decision.riskStatus).toBe('WARNING');
    expect(decision.reasons).toContain('negative_executable_exit');
    expect(decision.reduceOnly).toBe(false);
    expect(decision.negativeExitThrottle).toEqual({ sizeMultiplier: 0.25, extraHalfSpreadCents: 1.5 });
  });

  test('no negative exit throttle when exit is positive', () => {
    const manager = new StrategyRiskManager(config);
    // exit = 4 * (0.55 - 0.50) = +$0.20 → positive, no throttle
    const decision = manager.evaluateMarket({
      mode: 'paper',
      conditionId: 'market-1',
      tokenId: 'token-yes',
      position: makePosition({ netSize: -4, avgCost: 0.55 }),
      book: makeBook({ bestBid: 0.49, bestAsk: 0.50, spread: 0.01, spreadTicks: 1 }),
      currentFair: 0.495,
      primaryMarketQuoteSharePct: 50,
      hasActiveQuotes: true,
      isBookStale: false,
      killSwitchActive: false,
    });

    expect(decision.exitPnlAtBestBidAsk).toBeCloseTo(0.20);
    expect(decision.negativeExitThrottle).toBeNull();
  });
});
