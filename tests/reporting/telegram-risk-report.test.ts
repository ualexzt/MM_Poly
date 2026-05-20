import { formatTelegramRiskReport, TelegramRiskReportInput } from '../../src/reporting/telegram-risk-report';

function makeInput(overrides: Partial<TelegramRiskReportInput> = {}): TelegramRiskReportInput {
  return {
    mode: 'paper',
    startedAt: new Date('2026-05-03T14:36:45Z'),
    reportAt: new Date('2026-05-06T17:00:00Z'),
    warningsCount: 0,
    errorsCount: 0,
    pnl: {
      realizedPeriod: 0.28,
      realizedCumulative: 4.92,
      unrealizedFairBased: 10.99,
      estimatedMakerRebate: 0.66,
      estimatedTotalPnl: 16.57,
      valuationMode: 'fair',
    },
    activity: {
      fillsTotal: 145,
      buyFills: 31,
      sellFills: 114,
      buyContracts: 61,
      sellContracts: 228,
      totalContracts: 289,
      buyNotional: 32.75,
      sellNotional: 141.34,
      notionalVolume: 174.09,
      avgFillPrice: 0.6012,
      quoteTraces: 7934,
      quoteGeneratedCount: 7934,
      quoteRejectedCount: 0,
      activeMarkets: 3,
      primaryMarketConditionId: 'market-1',
      primaryMarketQuoteTraces: 7930,
      primaryMarketQuoteSharePct: 99.95,
    },
    risk: {
      status: 'WARNING',
      reasons: ['single_market_concentration_above_90_pct', 'reduce_only_short_inventory'],
      reduceOnlyActive: true,
      killSwitchActive: false,
      openPositions: 1,
      topMarketDecision: {
        conditionId: 'market-1',
        tokenId: 'token-yes',
        riskStatus: 'WARNING',
        reasons: ['single_market_concentration_above_90_pct', 'reduce_only_short_inventory'],
        reduceOnly: true,
        allowBuy: true,
        allowSell: false,
        inventoryUsagePct: 80,
        netPosition: -167,
        positionSide: 'SHORT',
        avgEntryPrice: 0.6208,
        currentFair: 0.555,
        currentBid: 0.55,
        currentAsk: 0.56,
        fairUnrealizedPnl: 10.99,
        exitPnlAtBestBidAsk: 10.15,
        worstCaseLossToZero: null,
        worstCaseLossToOne: 63.31,
      },
      singleMarketConcentrationPct: 99.95,
      unrealizedToRealizedRatio: 2.23,
    },
    marketTitleByConditionId: new Map([['market-1', 'Russia-Ukraine Ceasefire before GTA VI?']]),
    ...overrides,
  };
}

describe('formatTelegramRiskReport', () => {
  test('formats risk-oriented report with required sections and values', () => {
    const text = formatTelegramRiskReport(makeInput());

    expect(text).toContain('Oraculus Paper Report');
    expect(text).toContain('Status: WARNING');
    expect(text).toContain('Health');
    expect(text).toContain('PnL');
    expect(text).toContain('Activity');
    expect(text).toContain('Inventory');
    expect(text).toContain('Risk');
    expect(text).toContain('Main Market');
    expect(text).toContain('Action');
    expect(text).toContain('Mode: PAPER');
    expect(text).toContain('Realized Period: +$0.28');
    expect(text).toContain('Realized Total: +$4.92');
    expect(text).toContain('Unrealized: +$10.99');
    expect(text).toContain('Valuation: fair-based');
    expect(text).toContain('Fills: 145');
    expect(text).toContain('BUY: 31 fills / 61 contracts / $32.75');
    expect(text).toContain('SELL: 114 fills / 228 contracts / $141.34');
    expect(text).toContain('Active Markets: 3');
    expect(text).toContain('Open Positions: 1');
    expect(text).toContain('Position: SHORT 167');
    expect(text).toContain('Bid/Ask: 0.5500 / 0.5600');
    expect(text).toContain('Worst Case to YES=1.00: -$63.31');
    expect(text).toContain('Quote Share: 7,930 / 7,934');
    expect(text).not.toContain('Total Trades');
    expect(text).toContain('Estimated Total ex Rebates: +$15.91');
    expect(text).toContain('Inspect top inventory markets and reduce exposure before considering LIVE.');
  });

  test('handles null top market decision', () => {
    const text = formatTelegramRiskReport(makeInput({
      risk: {
        status: 'OK',
        reasons: [],
        reduceOnlyActive: false,
        killSwitchActive: false,
        openPositions: 0,
        topMarketDecision: null,
        singleMarketConcentrationPct: null,
        unrealizedToRealizedRatio: null,
      },
    }));

    expect(text).toContain('Status: OK');
    expect(text).toContain('Open Positions: 0');
    expect(text).toContain('Position: FLAT');
    expect(text).toContain('Main Market');
  });

  test('escapes html in market title', () => {
    const text = formatTelegramRiskReport(makeInput({
      marketTitleByConditionId: new Map([['market-1', 'A < B & C > D']]),
    }));

    expect(text).toContain('A &lt; B &amp; C &gt; D');
    expect(text).not.toContain('A < B & C > D');
  });

  test('uses inventory WATCH action when soft inventory limit is exceeded', () => {
    const text = formatTelegramRiskReport(makeInput({
      risk: {
        ...makeInput().risk,
        status: 'WATCH',
        reasons: ['inventory_soft_limit_exceeded'],
      },
    }));

    expect(text).toContain('Stay PAPER and monitor whether inventory decays back below soft limit.');
  });

  test('renders runtime-provided top inventory markets', () => {
    const base = makeInput();
    const text = formatTelegramRiskReport(makeInput({
      risk: {
        ...base.risk,
        topInventoryDecisions: [
          {
            conditionId: 'market-2',
            tokenId: 'token-yes-2',
            riskStatus: 'OK',
            reasons: [],
            reduceOnly: false,
            allowBuy: true,
            allowSell: true,
            inventoryUsagePct: 55.5,
            netPosition: 100,
            positionSide: 'LONG',
            avgEntryPrice: 0.4,
            currentFair: 0.45,
            currentBid: 0.44,
            currentAsk: 0.46,
            fairUnrealizedPnl: 5,
            exitPnlAtBestBidAsk: 4.5,
            worstCaseLossToZero: 40,
            worstCaseLossToOne: null,
          },
          {
            conditionId: 'market-3',
            tokenId: 'token-yes-3',
            riskStatus: 'OK',
            reasons: [],
            reduceOnly: false,
            allowBuy: true,
            allowSell: true,
            inventoryUsagePct: 30,
            netPosition: -50,
            positionSide: 'SHORT',
            avgEntryPrice: 0.7,
            currentFair: 0.65,
            currentBid: 0.64,
            currentAsk: 0.66,
            fairUnrealizedPnl: 2.5,
            exitPnlAtBestBidAsk: 2,
            worstCaseLossToZero: null,
            worstCaseLossToOne: 17,
          },
        ],
      },
      marketTitleByConditionId: new Map([
        ['market-1', 'Russia-Ukraine Ceasefire before GTA VI?'],
        ['market-2', 'Will bitcoin hit $1m before GTA VI?'],
        ['market-3', 'New Rihanna Album before GTA VI?'],
      ]),
    }));

    expect(text).toContain('Top Inventory Markets');
    expect(text).toContain('Will bitcoin hit $1m before GTA VI?');
    expect(text).toContain('LONG 100');
    expect(text).toContain('Inventory Usage: 55.50%');
    expect(text).toContain('New Rihanna Album before GTA VI?');
    expect(text).toContain('SHORT 50');
    expect(text).toContain('Inventory Usage: 30.00%');
  });

  test('renders top inventory fallback when no inventory decisions are provided', () => {
    const text = formatTelegramRiskReport(makeInput());
    expect(text).toContain('Top Inventory Markets');
    expect(text).toContain('n/a');
  });

  test('renders non-OK duration and worsening risk trajectory', () => {
    const base = makeInput();
    const text = formatTelegramRiskReport(makeInput({
      risk: {
        ...base.risk,
        status: 'WARNING',
        reasons: ['inventory_soft_limit_exceeded', 'reduce_only_long_inventory'],
        reduceOnlyActive: true,
        timeInNonOkStatusMs: 90 * 60 * 1000,
        riskTrajectory: {
          previousStatus: 'WATCH',
          currentStatus: 'WARNING',
          previousUsagePct: 17.1,
          currentUsagePct: 58.8,
          usageDirection: 'worsening',
          previousReduceOnly: false,
          currentReduceOnly: true,
          previousReasons: ['inventory_soft_limit_exceeded'],
          currentReasons: ['inventory_soft_limit_exceeded', 'reduce_only_long_inventory'],
        },
      },
    }));

    expect(text).toContain('Time in Non-OK: 1h 30m');
    expect(text).toContain('Risk Trajectory');
    expect(text).toContain('Status: WATCH → WARNING');
    expect(text).toContain('Inventory Usage: 17.10% → 58.80% worsening');
    expect(text).toContain('Reduce-only: OFF → ON');
    expect(text).toContain('Reasons: inventory_soft_limit_exceeded → inventory_soft_limit_exceeded, reduce_only_long_inventory');
  });

  test('renders diagnostic fallbacks when duration and trajectory are unavailable', () => {
    const text = formatTelegramRiskReport(makeInput());

    expect(text).toContain('Time in Non-OK: n/a');
    expect(text).toContain('Status: n/a');
    expect(text).toContain('Inventory Usage: n/a');
    expect(text).toContain('Reduce-only: n/a');
    expect(text).toContain('Reasons: n/a');
  });
});
