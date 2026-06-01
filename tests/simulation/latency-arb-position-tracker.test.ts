import { LatencyArbPositionTracker, WouldOrder } from '../../src/simulation/latency-arb-position-tracker';
import { LatencyArbExecutionSnapshot } from '../../src/strategy/latency-arb-orderbook';

const order: WouldOrder = {
  orderId: 'shadow-1',
  conditionId: 'cond',
  action: 'BUY_YES',
  makerPrice: 0.44,
  sizeUsd: 1.548,
  shares: 1.548 / 0.44,
  placedAtMs: 1700000000000,
};

const execution: LatencyArbExecutionSnapshot = {
  yesBestBid: 0.45,
  yesBestAsk: 0.47,
  noBestBid: 0.53,
  noBestAsk: 0.55,
  tickSize: 0.01,
  minOrderSize: 1,
};

describe('LatencyArbPositionTracker', () => {
  it('should open maker position only after simulated latency and cross-through', () => {
    const events: Record<string, unknown>[] = [];
    const tracker = new LatencyArbPositionTracker({ simulatedLatencyMs: 750 }, (event) => events.push(event));

    expect(tracker.tryOpenFromMakerCross(order, { ...execution, yesBestAsk: 0.44 }, 1700000000500)).toBe(false);
    expect(tracker.getOpenExposureUsd()).toBe(0);

    expect(tracker.tryOpenFromMakerCross(order, { ...execution, yesBestAsk: 0.43 }, 1700000000800)).toBe(true);
    expect(tracker.getOpenExposureUsd()).toBeCloseTo(1.548, 3);
    expect(events[0]).toMatchObject({ eventType: 'position_opened', orderId: 'shadow-1' });
  });

  it('should mark YES position to market', () => {
    const events: Record<string, unknown>[] = [];
    const tracker = new LatencyArbPositionTracker({ simulatedLatencyMs: 750 }, (event) => events.push(event));

    tracker.tryOpenFromMakerCross(order, { ...execution, yesBestAsk: 0.43 }, 1700000000800);
    tracker.markToMarket('cond', execution, 1700000001000);

    expect(events[1]).toMatchObject({ eventType: 'mark_to_market', orderId: 'shadow-1' });
    expect(events[1].unrealizedPnlUsd as number).toBeGreaterThan(0);
  });

  it('should resolve winning and losing positions', () => {
    const events: Record<string, unknown>[] = [];
    const tracker = new LatencyArbPositionTracker({ simulatedLatencyMs: 750 }, (event) => events.push(event));

    tracker.tryOpenFromMakerCross(order, { ...execution, yesBestAsk: 0.43 }, 1700000000800);
    tracker.resolve('cond', 'YES', 1700000010000);

    const resolution = events.find((event) => event.eventType === 'position_resolved');
    expect(resolution).toMatchObject({ orderId: 'shadow-1', outcome: 'YES' });
    expect(resolution?.realizedPnlUsd as number).toBeGreaterThan(0);
    expect(tracker.getOpenExposureUsd()).toBe(0);
  });
});
