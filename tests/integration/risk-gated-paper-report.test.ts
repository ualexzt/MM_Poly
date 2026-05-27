import { TradingActivityTracker } from '../../src/accounting/trading-activity-tracker';
import { PaperPnlTracker } from '../../src/accounting/paper-pnl-tracker';
import { StrategyRiskManager, maxRiskStatus } from '../../src/risk/strategy-risk-manager';
import { formatTelegramRiskReport } from '../../src/reporting/telegram-risk-report';
import { BookState } from '../../src/types/book';

function makeBook(): BookState {
  return {
    conditionId: 'market-1',
    tokenId: 'token-yes',
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
    bids: [{ price: 0.55, size: 100, sizeUsd: 55 }],
    asks: [{ price: 0.56, size: 100, sizeUsd: 56 }],
    lastUpdateMs: Date.now(),
  };
}

describe('risk-gated paper report integration', () => {
  test('large short inventory blocks sell side and appears in report', () => {
    const pnlTracker = new PaperPnlTracker();
    const activityTracker = new TradingActivityTracker();
    const riskManager = new StrategyRiskManager({
      softInventoryLimitPct: 25,
      reduceOnlyLimitPct: 70,
      hardInventoryLimitPct: 90,
      maxMarketExposureUsd: 50, // previously 100 contracts at ~$0.5
      concentrationWarningPct: 90,
      concentrationCriticalPctLive: 90,
    });

    const fill = {
      orderId: 'sell-1',
      tokenId: 'token-yes',
      side: 'SELL' as const,
      filledPrice: 0.62,
      filledSize: 80,
      remainingSize: 0,
    };

    pnlTracker.onFill(fill, 0.62);
    activityTracker.recordFill('market-1', fill);
    activityTracker.recordQuoteGenerated('market-1');
    activityTracker.recordQuoteGenerated('market-1');
    activityTracker.recordQuoteSkipped('market-1', 'staleBookSkipped');
    activityTracker.recordQuoteSkipped('market-1', 'quoteEngineNullSkipped');

    const activity = activityTracker.snapshot();
    const decision = riskManager.evaluateMarket({
      mode: 'paper',
      conditionId: 'market-1',
      tokenId: 'token-yes',
      position: pnlTracker.getPosition('token-yes'),
      book: makeBook(),
      currentFair: 0.555,
      primaryMarketQuoteSharePct: activity.primaryMarketQuoteSharePct,
      hasActiveQuotes: true,
      isBookStale: false,
      killSwitchActive: false,
    });

    expect(decision.allowBuy).toBe(true);
    expect(decision.allowSell).toBe(false);
    expect(decision.reduceOnly).toBe(true);

    const text = formatTelegramRiskReport({
      mode: 'paper',
      startedAt: new Date('2026-05-03T14:36:45Z'),
      reportAt: new Date('2026-05-06T17:00:00Z'),
      warningsCount: 0,
      errorsCount: 0,
      pnl: {
        realizedPeriod: 0,
        realizedCumulative: pnlTracker.getCumulativeRealizedPnl(),
        unrealizedFairBased: decision.fairUnrealizedPnl,
        estimatedMakerRebate: 0,
        estimatedTotalPnl: pnlTracker.getCumulativeRealizedPnl() + decision.fairUnrealizedPnl,
        valuationMode: 'fair',
      },
      activity,
      risk: {
        status: maxRiskStatus([decision.riskStatus]),
        reasons: decision.reasons,
        reduceOnlyActive: decision.reduceOnly,
        killSwitchActive: false,
        openPositions: 1,
        topMarketDecision: decision,
        singleMarketConcentrationPct: activity.primaryMarketQuoteSharePct,
        unrealizedToRealizedRatio: null,
      },
      marketTitleByConditionId: new Map([['market-1', 'Risk Test Market']]),
    });

    expect(text).toContain('Status: WARNING');
    expect(text).toContain('Position: SHORT 80');
    expect(text).toContain('Reduce-only: ON');
    expect(text).toContain('Risk Test Market');
    expect(text).toContain('Quotes: 4 submitted/replaced: 2 risk-blocked: 0 skipped: 2');
    expect(text).toContain('Skips: stale book 1, invalid book 0, invalid fair 0, cooldown 0, no quote 1, unchanged 0');
    expect(text).not.toContain('Total Trades');
  });

  test('negative executable exit appears as critical action in paper report', () => {
    const activityTracker = new TradingActivityTracker();
    const riskManager = new StrategyRiskManager({
      softInventoryLimitPct: 25,
      reduceOnlyLimitPct: 70,
      hardInventoryLimitPct: 90,
      maxMarketExposureUsd: 10,
      concentrationWarningPct: 90,
      concentrationCriticalPctLive: 90,
      maxBookSpreadCents: 8,
      negativeExitWarningUsd: 0,
      negativeExitCriticalUsd: -0.25,
    });

    activityTracker.recordQuoteGenerated('market-1');

    const decision = riskManager.evaluateMarket({
      mode: 'paper',
      conditionId: 'market-1',
      tokenId: 'token-yes',
      position: {
        tokenId: 'token-yes',
        netSize: -2,
        avgCost: 0.65,
        realizedPnl: 0,
        totalBoughtUsd: 0,
        totalSoldUsd: 1.30,
        totalVolumeUsd: 1.30,
      },
      book: {
        ...makeBook(),
        bestBid: 0.01,
        bestAsk: 0.99,
        midpoint: 0.50,
        spread: 0.98,
        spreadTicks: 98,
      },
      currentFair: 0.2555,
      primaryMarketQuoteSharePct: activityTracker.snapshot().primaryMarketQuoteSharePct,
      hasActiveQuotes: true,
      isBookStale: false,
      killSwitchActive: false,
    });

    // exit PnL = 2 * (0.65 - 0.99) = -$0.68 < -$0.25 → CRITICAL + reduce-only
    expect(decision.riskStatus).toBe('CRITICAL');
    expect(decision.reasons).toContain('severe_negative_executable_exit');
    expect(decision.reduceOnly).toBe(true);
    expect(decision.allowBuy).toBe(true);
    expect(decision.allowSell).toBe(false);

    const text = formatTelegramRiskReport({
      mode: 'paper',
      startedAt: new Date('2026-05-24T00:00:00Z'),
      reportAt: new Date('2026-05-24T17:00:00Z'),
      warningsCount: 0,
      errorsCount: 0,
      pnl: {
        realizedPeriod: 0,
        realizedCumulative: 0,
        unrealizedFairBased: decision.fairUnrealizedPnl,
        estimatedMakerRebate: 0,
        estimatedTotalPnl: decision.fairUnrealizedPnl,
        valuationMode: 'fair',
      },
      activity: activityTracker.snapshot(),
      risk: {
        status: maxRiskStatus([decision.riskStatus]),
        reasons: decision.reasons,
        reduceOnlyActive: decision.reduceOnly,
        killSwitchActive: false,
        openPositions: 1,
        topMarketDecision: decision,
        topInventoryDecisions: [decision],
        singleMarketConcentrationPct: activityTracker.snapshot().primaryMarketQuoteSharePct,
        unrealizedToRealizedRatio: null,
      },
      marketTitleByConditionId: new Map([['market-1', 'Wide Book Test Market']]),
    });

    expect(text).toContain('Status: CRITICAL');
    expect(text).toContain('severe_negative_executable_exit');
    expect(text).toContain('wide_book_spread');
    expect(text).toContain('Exit at Bid/Ask: -$0.68');
    expect(text).toContain('Stay PAPER. Investigate wide-book or executable-exit risk before considering LIVE.');
  });
});
