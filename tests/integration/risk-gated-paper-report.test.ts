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
      maxMarketExposureContracts: 100,
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
    expect(text).not.toContain('Total Trades');
  });
});
