import { LatencyArbExecutionSnapshot } from '../strategy/latency-arb-orderbook';

export interface WouldOrder {
  orderId: string;
  conditionId: string;
  action: 'BUY_YES' | 'BUY_NO';
  makerPrice: number;
  sizeUsd: number;
  shares: number;
  placedAtMs: number;
}

export interface LatencyArbPositionTrackerConfig {
  simulatedLatencyMs: number;
}

interface OpenPosition extends WouldOrder {
  openedAtMs: number;
}

type WriteEvent = (event: Record<string, unknown>) => void;

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function hasValidOrderNumbers(order: WouldOrder): boolean {
  return finitePositive(order.makerPrice) &&
    finitePositive(order.sizeUsd) &&
    finitePositive(order.shares) &&
    finiteNonNegative(order.placedAtMs);
}

export class LatencyArbPositionTracker {
  private readonly pendingOrders: WouldOrder[] = [];
  private readonly pendingOrderIds = new Set<string>();
  private readonly openedOrderIds = new Set<string>();
  private readonly openPositions: OpenPosition[] = [];

  constructor(private readonly config: LatencyArbPositionTrackerConfig, private readonly writeEvent: WriteEvent) {}

  addPendingOrder(order: WouldOrder): void {
    if (!hasValidOrderNumbers(order)) return;
    if (this.pendingOrderIds.has(order.orderId) || this.openedOrderIds.has(order.orderId)) return;

    this.pendingOrders.push(order);
    this.pendingOrderIds.add(order.orderId);
  }

  tryOpenFromMakerCross(order: WouldOrder, execution: LatencyArbExecutionSnapshot, nowMs: number): boolean {
    if (this.openedOrderIds.has(order.orderId)) return false;
    if (!finiteNonNegative(this.config.simulatedLatencyMs) || !finiteNonNegative(nowMs) || !hasValidOrderNumbers(order)) {
      return false;
    }
    if (nowMs - order.placedAtMs < this.config.simulatedLatencyMs) return false;

    const bestAsk = order.action === 'BUY_YES' ? execution.yesBestAsk : execution.noBestAsk;
    if (!finitePositive(bestAsk) || bestAsk >= order.makerPrice) return false;

    const position: OpenPosition = { ...order, openedAtMs: nowMs };
    this.openPositions.push(position);
    this.openedOrderIds.add(order.orderId);
    this.removePendingOrder(order.orderId);
    this.writeEvent({
      eventType: 'position_opened',
      timestamp: nowMs,
      orderId: order.orderId,
      conditionId: order.conditionId,
      action: order.action,
      entryPrice: order.makerPrice,
      sizeUsd: order.sizeUsd,
      shares: order.shares,
    });
    return true;
  }

  processPending(executionByCondition: Map<string, LatencyArbExecutionSnapshot>, nowMs: number): void {
    for (const order of [...this.pendingOrders]) {
      const execution = executionByCondition.get(order.conditionId);
      if (!execution) continue;
      this.tryOpenFromMakerCross(order, execution, nowMs);
    }
  }

  private removePendingOrder(orderId: string): void {
    const index = this.pendingOrders.findIndex((order) => order.orderId === orderId);
    if (index >= 0) {
      this.pendingOrders.splice(index, 1);
    }
    this.pendingOrderIds.delete(orderId);
  }

  markToMarket(conditionId: string, execution: LatencyArbExecutionSnapshot, nowMs: number): void {
    for (const position of this.openPositions.filter((p) => p.conditionId === conditionId)) {
      const markPrice = position.action === 'BUY_YES' ? execution.yesBestBid : execution.noBestBid;
      if (!Number.isFinite(markPrice) || markPrice <= 0) {
        this.writeEvent({ eventType: 'skip', timestamp: nowMs, conditionId, reason: 'no_valid_mtm_price' });
        continue;
      }
      const markValueUsd = position.shares * markPrice;
      const unrealizedPnlUsd = markValueUsd - position.sizeUsd;
      this.writeEvent({
        eventType: 'mark_to_market',
        timestamp: nowMs,
        orderId: position.orderId,
        conditionId,
        action: position.action,
        markPrice,
        markValueUsd,
        unrealizedPnlUsd,
      });
    }
  }

  resolve(conditionId: string, outcome: 'YES' | 'NO', nowMs: number): void {
    for (let i = this.openPositions.length - 1; i >= 0; i--) {
      const position = this.openPositions[i];
      if (position.conditionId !== conditionId) continue;
      const win = (position.action === 'BUY_YES' && outcome === 'YES') ||
        (position.action === 'BUY_NO' && outcome === 'NO');
      const exitPrice = win ? 1 : 0;
      const proceedsUsd = position.shares * exitPrice;
      const realizedPnlUsd = proceedsUsd - position.sizeUsd;
      this.writeEvent({
        eventType: 'position_resolved',
        timestamp: nowMs,
        orderId: position.orderId,
        conditionId,
        action: position.action,
        outcome,
        exitPrice,
        proceedsUsd,
        realizedPnlUsd,
      });
      this.openPositions.splice(i, 1);
    }
  }

  getOpenExposureUsd(): number {
    return this.openPositions.reduce((sum, position) => sum + position.sizeUsd, 0);
  }
}
