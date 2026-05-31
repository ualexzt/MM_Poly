import { formatSmallLiveAlert, formatSmallLiveTelegramReport } from '../../src/reporting/small-live-telegram-report';

describe('small-live Telegram formatting', () => {
  test('formats compact 3h small_live report with key account and risk content', () => {
    const text = formatSmallLiveTelegramReport({
      mode: 'shadow',
      reportAt: new Date('2026-05-31T09:00:00Z'),
      balanceUsd: 15.48,
      openOrdersCount: 0,
      openOrdersNotionalUsd: 0,
      positionsCount: 0,
      positionsValueUsd: 0,
      realizedPnlUsd: 0.12,
      unrealizedPnlUsd: -0.03,
      fillsCount: 2,
      rejectsCount: 1,
      activeMarkets: 1,
      riskState: 'OK',
    });

    expect(text).toContain('Small Live Report');
    expect(text).toContain('Mode: shadow');
    expect(text).toContain('Balance: $15.48');
    expect(text).toContain('Open orders: 0 / $0.00');
    expect(text).toContain('Positions: 0 / $0.00');
    expect(text).toContain('PnL: realized $0.12 / unrealized -$0.03');
    expect(text).toContain('Fills 3h: 2');
    expect(text).toContain('Rejects 3h: 1');
    expect(text).toContain('Active markets: 1');
    expect(text).toContain('Risk state: OK');
  });

  test('formats compact severity/title/detail alert text', () => {
    const text = formatSmallLiveAlert({
      severity: 'CRITICAL',
      title: 'Open order leak',
      detail: '43 open orders detected',
    });

    expect(text).toContain('CRITICAL');
    expect(text).toContain('Open order leak');
    expect(text).toContain('43 open orders detected');
  });
});
