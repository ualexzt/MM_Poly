import { evaluateSmallLiveGoNoGo } from '../../src/risk/small-live-go-no-go';

describe('small-live go/no-go gate', () => {
  test('returns go when all paper-soak and verification checks pass', () => {
    const result = evaluateSmallLiveGoNoGo({
      riskStatus: 'OK',
      reasons: [],
      realizedPnlExRebatesUsd: 1.25,
      worstTopInventoryExitPnlUsd: -0.10,
      testsPassing: true,
      buildPassing: true,
    });

    expect(result.go).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  test('blocks live for persistent critical risk and severe executable exit', () => {
    const result = evaluateSmallLiveGoNoGo({
      riskStatus: 'CRITICAL',
      reasons: ['severe_negative_executable_exit'],
      realizedPnlExRebatesUsd: 1,
      worstTopInventoryExitPnlUsd: -0.10,
      testsPassing: true,
      buildPassing: true,
    });

    expect(result.go).toBe(false);
    expect(result.blockers).toContain('risk_status_not_ok');
    expect(result.blockers).toContain('severe_negative_executable_exit');
  });

  test('blocks live when top inventory executable exit is worse than -25 cents', () => {
    const result = evaluateSmallLiveGoNoGo({
      riskStatus: 'OK',
      reasons: [],
      realizedPnlExRebatesUsd: 1,
      worstTopInventoryExitPnlUsd: -0.26,
      testsPassing: true,
      buildPassing: true,
    });

    expect(result.go).toBe(false);
    expect(result.blockers).toContain('top_inventory_exit_worse_than_minus_25c');
  });

  test('blocks live when realized PnL excluding rebates or verification is not passing', () => {
    const result = evaluateSmallLiveGoNoGo({
      riskStatus: 'OK',
      reasons: [],
      realizedPnlExRebatesUsd: 0,
      worstTopInventoryExitPnlUsd: null,
      testsPassing: false,
      buildPassing: false,
    });

    expect(result.go).toBe(false);
    expect(result.blockers).toEqual([
      'realized_pnl_ex_rebates_not_positive',
      'tests_not_passing',
      'build_not_passing',
    ]);
  });
});
