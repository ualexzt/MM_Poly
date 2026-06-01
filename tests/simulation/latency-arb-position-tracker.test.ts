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

  it('should not open the same order twice', () => {
    const events: Record<string, unknown>[] = [];
    const tracker = new LatencyArbPositionTracker({ simulatedLatencyMs: 750 }, (event) => events.push(event));

    expect(tracker.tryOpenFromMakerCross(order, { ...execution, yesBestAsk: 0.43 }, 1700000000800)).toBe(true);
    expect(tracker.tryOpenFromMakerCross(order, { ...execution, yesBestAsk: 0.43 }, 1700000000900)).toBe(false);

    expect(tracker.getOpenExposureUsd()).toBeCloseTo(1.548, 3);
    expect(events.filter((event) => event.eventType === 'position_opened')).toHaveLength(1);
  });

  it('should process pending orders once and ignore duplicate pending order ids', () => {
    const events: Record<string, unknown>[] = [];
    const tracker = new LatencyArbPositionTracker({ simulatedLatencyMs: 750 }, (event) => events.push(event));

    tracker.addPendingOrder(order);
    tracker.addPendingOrder(order);
    tracker.processPending(new Map([['cond', { ...execution, yesBestAsk: 0.43 }]]), 1700000000800);
    tracker.processPending(new Map([['cond', { ...execution, yesBestAsk: 0.42 }]]), 1700000000900);

    expect(events.filter((event) => event.eventType === 'position_opened')).toHaveLength(1);
    expect(tracker.getOpenExposureUsd()).toBeCloseTo(1.548, 3);
  });

  it('should reject invalid order numbers before opening', () => {
    const events: Record<string, unknown>[] = [];
    const tracker = new LatencyArbPositionTracker({ simulatedLatencyMs: 750 }, (event) => events.push(event));

    expect(tracker.tryOpenFromMakerCross({ ...order, makerPrice: Number.POSITIVE_INFINITY }, execution, 1700000000800)).toBe(false);
    expect(tracker.tryOpenFromMakerCross({ ...order, shares: Number.NaN }, execution, 1700000000800)).toBe(false);
    expect(tracker.tryOpenFromMakerCross({ ...order, sizeUsd: -1 }, execution, 1700000000800)).toBe(false);
    expect(tracker.tryOpenFromMakerCross({ ...order, placedAtMs: Number.NaN }, execution, 1700000000800)).toBe(false);
    expect(events.filter((event) => event.eventType === 'position_opened')).toHaveLength(0);
  });

  it('should mark YES position to market', () => {
    const events: Record<string, unknown>[] = [];
    const tracker = new LatencyArbPositionTracker({ simulatedLatencyMs: 750 }, (event) => events.push(event));

    tracker.tryOpenFromMakerCross(order, { ...execution, yesBestAsk: 0.43 }, 1700000000800);
    tracker.markToMarket('cond', execution, 1700000001000);

    expect(events[1]).toMatchObject({ eventType: 'mark_to_market', orderId: 'shadow-1' });
    expect(events[1].unrealizedPnlUsd as number).toBeGreaterThan(0);
  });

  it('should support BUY_NO fill, mark-to-market, and resolution', () => {
    const events: Record<string, unknown>[] = [];
    const tracker = new LatencyArbPositionTracker({ simulatedLatencyMs: 750 }, (event) => events.push(event));
    const noOrder: WouldOrder = {
      ...order,
      orderId: 'shadow-no-1',
      action: 'BUY_NO',
      makerPrice: 0.54,
      shares: 1.548 / 0.54,
    };

    expect(tracker.tryOpenFromMakerCross(noOrder, { ...execution, noBestAsk: 0.53 }, 1700000000800)).toBe(true);
    tracker.markToMarket('cond', { ...execution, noBestBid: 0.56 }, 1700000001000);
    tracker.resolve('cond', 'NO', 1700000010000);

    const mtm = events.find((event) => event.eventType === 'mark_to_market');
    const resolution = events.find((event) => event.eventType === 'position_resolved');
    expect(mtm).toMatchObject({ orderId: 'shadow-no-1', action: 'BUY_NO', markPrice: 0.56 });
    expect(resolution).toMatchObject({ orderId: 'shadow-no-1', outcome: 'NO' });
    expect(resolution?.realizedPnlUsd as number).toBeGreaterThan(0);
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
