import { evaluateLiveAccountRisk } from '../../src/risk/live-account-risk';

describe('live-account-risk', () => {
  test('blocks live when open orders exceed internal expectation', () => {
    const result = evaluateLiveAccountRisk({
      mode: 'small_live',
      liveTradingEnabled: true,
      maxMarkets: 2,
      maxExposureUsd: 10,
      telegramConfigured: true,
      telegramHealthy: true,
      collateralBalanceUsd: 15,
      openOrderNotionalUsd: 4,
      expectedOpenOrderNotionalUsd: 0,
      positionsValueUsd: 0,
      minRequiredOrderUsd: 1.5,
      submitRejectsLastWindow: 0,
    });

    expect(result.ok).toBe(false);
    expect(result.blockers).toContain('open_order_leak');
  });

  test('blocks live when projected active exposure exceeds envelope', () => {
    const result = evaluateLiveAccountRisk({
      mode: 'small_live',
      liveTradingEnabled: true,
      maxMarkets: 2,
      maxExposureUsd: 10,
      telegramConfigured: true,
      telegramHealthy: true,
      collateralBalanceUsd: 15,
      openOrderNotionalUsd: 9,
      expectedOpenOrderNotionalUsd: 9,
      positionsValueUsd: 2,
      minRequiredOrderUsd: 1.5,
      submitRejectsLastWindow: 0,
    });

    expect(result.ok).toBe(false);
    expect(result.blockers).toContain('active_exposure_above_limit');
  });

  test('warns but does not block when free balance is only slightly above one order', () => {
    const result = evaluateLiveAccountRisk({
      mode: 'small_live',
      liveTradingEnabled: true,
      maxMarkets: 1,
      maxExposureUsd: 10,
      telegramConfigured: true,
      telegramHealthy: true,
      collateralBalanceUsd: 3,
      openOrderNotionalUsd: 1.3,
      expectedOpenOrderNotionalUsd: 1.3,
      positionsValueUsd: 0,
      minRequiredOrderUsd: 1.3,
      submitRejectsLastWindow: 0,
    });

    expect(result.ok).toBe(true);
    expect(result.warnings).toContain('low_free_balance');
  });

  test('blocks live when Telegram is unavailable', () => {
    const result = evaluateLiveAccountRisk({
      mode: 'small_live',
      liveTradingEnabled: true,
      maxMarkets: 2,
      maxExposureUsd: 10,
      telegramConfigured: true,
      telegramHealthy: false,
      collateralBalanceUsd: 15,
      openOrderNotionalUsd: 0,
      expectedOpenOrderNotionalUsd: 0,
      positionsValueUsd: 0,
      minRequiredOrderUsd: 1.5,
      submitRejectsLastWindow: 0,
    });

    expect(result.ok).toBe(false);
    expect(result.blockers).toContain('telegram_unhealthy');
  });
});
