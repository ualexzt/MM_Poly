import { SmallLiveMetrics } from '../../src/monitoring/small-live-metrics';

describe('SmallLiveMetrics', () => {
  test('tracks and resets 3h window counters', () => {
    const metrics = new SmallLiveMetrics();

    metrics.recordSubmit('live');
    metrics.recordSubmit('matched');
    metrics.recordReject('balance');
    metrics.recordAlert('low_balance');
    metrics.recordCycleLag(7000);

    expect(metrics.snapshot()).toEqual({
      liveSubmits: 1,
      matchedSubmits: 1,
      rejects: { balance: 1 },
      alerts: { low_balance: 1 },
      maxCycleLagMs: 7000,
    });

    expect(metrics.reset()).toEqual({
      liveSubmits: 1,
      matchedSubmits: 1,
      rejects: { balance: 1 },
      alerts: { low_balance: 1 },
      maxCycleLagMs: 7000,
    });
    expect(metrics.snapshot()).toEqual({
      liveSubmits: 0,
      matchedSubmits: 0,
      rejects: {},
      alerts: {},
      maxCycleLagMs: 0,
    });
  });

  test('snapshot returns a defensive copy', () => {
    const metrics = new SmallLiveMetrics();
    metrics.recordReject('balance');
    metrics.recordAlert('open_order_leak');

    const snapshot = metrics.snapshot();
    snapshot.rejects.balance = 99;
    snapshot.alerts.open_order_leak = 99;

    expect(metrics.snapshot()).toMatchObject({
      rejects: { balance: 1 },
      alerts: { open_order_leak: 1 },
    });
  });
});
