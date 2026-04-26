import { KillSwitch } from '../../src/risk/kill-switch';

describe('kill-switch', () => {
  test('ok when everything normal', () => {
    const ks = new KillSwitch({ cancelAllOnWsDisconnectSeconds: 3, cancelAllOnApiErrorRatePct: 20 });
    expect(ks.check({ connected: true, disconnectedAt: null }, { errorsLast60s: 0, totalLast60s: 100 }, { currentDrawdownPct: 0 })).toBe('OK');
  });

  test('cancel all on ws disconnect', () => {
    const ks = new KillSwitch({ cancelAllOnWsDisconnectSeconds: 3 });
    expect(ks.check({ connected: false, disconnectedAt: Date.now() - 5000 }, { errorsLast60s: 0, totalLast60s: 100 }, { currentDrawdownPct: 0 })).toBe('CANCEL_ALL');
  });
});
