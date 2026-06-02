import { BookLevel, BookState } from '../types/book';
import { getExecutableBuyPrice } from './executable-price';
import { averageCostOfLots, rebuildPairCostInventoryState } from './pair-cost-inventory';
import {
  InventoryLot,
  PairCostDecision,
  PairCostDecisionLog,
  PairCostSide,
  PairCostSkipReason,
  PairCostState,
  PairCostStrategyConfig,
  PairCostStrategyOrder,
} from './pair-cost-types';

interface PairCostMarketStatus {
  enabled: boolean;
  closed: boolean;
  resolving: boolean;
}

interface ProbeCandidate {
  side: PairCostSide;
  qty: number;
  limitPrice: number;
  mispricing: number;
}

export interface DecidePairCostStrategyTickInput {
  marketId: string;
  config: PairCostStrategyConfig;
  lots: InventoryLot[];
  books: Record<PairCostSide, BookState>;
  now: Date;
  timeToCloseSeconds: number;
  market: PairCostMarketStatus;
  activeOrder?: PairCostStrategyOrder | null;
  currentMarketExposureUsd?: number;
  probeCandidate?: ProbeCandidate | null;
}

export interface PairCostFillEvent {
  qty: number;
  price: number;
  timestamp: Date;
}

export interface ApplyPairCostFillInput {
  marketId: string;
  lots: InventoryLot[];
  activeOrder: PairCostStrategyOrder;
  fill: PairCostFillEvent;
  now: Date;
  config: PairCostStrategyConfig;
}

export interface ApplyPairCostFillResult {
  inventoryState: ReturnType<typeof rebuildPairCostInventoryState>;
  order: PairCostStrategyOrder;
  cancelRemaining: boolean;
}

const ROUND_FACTOR = 1_000_000_000;

function round(value: number): number {
  return Math.round(value * ROUND_FACTOR) / ROUND_FACTOR;
}

function isActive(order?: PairCostStrategyOrder | null): boolean {
  return order?.status === 'OPEN' || order?.status === 'PARTIAL';
}

function totalQty(lots: InventoryLot[]): number {
  return round(lots.reduce((sum, lot) => sum + lot.remainingQty, 0));
}

function totalCost(lots: InventoryLot[]): number {
  return round(lots.reduce((sum, lot) => sum + lot.remainingQty * lot.price, 0));
}

function bookIsStale(book: BookState, now: Date, maxAgeMs: number): boolean {
  return now.getTime() - book.lastUpdateMs > maxAgeMs;
}

function worstSpread(books: Record<PairCostSide, BookState>): number {
  return Math.max(books.YES.spread ?? 0, books.NO.spread ?? 0);
}

function makeLog(
  input: DecidePairCostStrategyTickInput,
  state: ReturnType<typeof rebuildPairCostInventoryState>,
  decision: PairCostDecision['decision'],
  reason: PairCostDecision['reason'],
  candidate: Partial<Pick<PairCostDecisionLog,
    'candidateAction' |
    'candidateSide' |
    'candidateQty' |
    'candidateExecPrice' |
    'projectedPairCost' |
    'edgePerPair'
  >> = {},
  overrideState?: PairCostState,
): PairCostDecisionLog {
  return {
    timestamp: input.now.toISOString(),
    marketId: input.marketId,
    strategy: 'pair_cost',
    state: overrideState ?? state.state,
    yesQty: totalQty(state.yesLots),
    noQty: totalQty(state.noLots),
    pairedQty: state.pairedQty,
    unpairedYesQty: state.unpairedYesQty,
    unpairedNoQty: state.unpairedNoQty,
    lockedProfit: state.lockedProfit,
    candidateAction: candidate.candidateAction ?? null,
    candidateSide: candidate.candidateSide ?? null,
    candidateQty: candidate.candidateQty ?? null,
    candidateExecPrice: candidate.candidateExecPrice ?? null,
    projectedPairCost: candidate.projectedPairCost ?? null,
    edgePerPair: candidate.edgePerPair ?? null,
    decision,
    reason,
  };
}

function skip(
  input: DecidePairCostStrategyTickInput,
  state: ReturnType<typeof rebuildPairCostInventoryState>,
  reason: PairCostSkipReason,
  candidate: Partial<Pick<PairCostDecisionLog,
    'candidateAction' |
    'candidateSide' |
    'candidateQty' |
    'candidateExecPrice' |
    'projectedPairCost' |
    'edgePerPair'
  >> = {},
  overrideState?: PairCostState,
): PairCostDecision {
  return {
    decision: 'SKIP',
    reason,
    order: null,
    log: makeLog(input, state, 'SKIP', reason, candidate, overrideState),
  };
}

function passesMarketQuality(
  input: DecidePairCostStrategyTickInput,
  state: ReturnType<typeof rebuildPairCostInventoryState>,
  targetSide: PairCostSide,
): PairCostDecision | null {
  if (input.timeToCloseSeconds < input.config.noNewPairLastSeconds) {
    return skip(input, state, PairCostSkipReason.TIME_TO_CLOSE_TOO_LOW);
  }

  if (worstSpread(input.books) > input.config.maxSpread) {
    return skip(input, state, PairCostSkipReason.SPREAD_TOO_WIDE);
  }

  if (input.books[targetSide].depth3Usd < input.config.minDepthUsd) {
    return skip(input, state, PairCostSkipReason.DEPTH_TOO_LOW);
  }

  return null;
}

function oldestUnpairedAgeSeconds(lots: InventoryLot[], now: Date): number {
  if (lots.length === 0) return 0;
  const oldestMs = Math.min(...lots.map(lot => lot.timestamp.getTime()));
  return (now.getTime() - oldestMs) / 1000;
}

function timedOut(input: DecidePairCostStrategyTickInput, lots: InventoryLot[]): boolean {
  return input.config.reduceOnlyOnTimeout &&
    oldestUnpairedAgeSeconds(lots, input.now) > input.config.maxUnpairedHoldSeconds;
}

function hedgeQtyFor(input: DecidePairCostStrategyTickInput, targetSide: PairCostSide, unpairedQty: number): number {
  const bestAsk = input.books[targetSide].bestAsk ?? input.books[targetSide].asks[0]?.price ?? 0;
  if (bestAsk <= 0) return 0;

  const caps = [
    unpairedQty,
    input.config.maxSingleOrderUsd / bestAsk,
  ];

  if (input.config.maxSingleOrderQty !== null) caps.push(input.config.maxSingleOrderQty);

  return round(Math.min(...caps));
}

function simulatedFillKeepsHedgeNeutral(
  input: DecidePairCostStrategyTickInput,
  state: ReturnType<typeof rebuildPairCostInventoryState>,
  targetSide: PairCostSide,
  qty: number,
  levelsUsed: BookLevel[],
): boolean {
  const simulatedLots: InventoryLot[] = levelsUsed.map((level, index) => ({
    id: `simulated-hedge-fill-${index}`,
    marketId: input.marketId,
    side: targetSide,
    qty: level.size,
    remainingQty: level.size,
    price: level.price,
    cost: round(level.size * level.price),
    timestamp: new Date(input.now.getTime() + index),
    sourceOrderId: null,
  }));
  const simulated = rebuildPairCostInventoryState({
    marketId: input.marketId,
    lots: [...input.lots, ...simulatedLots],
    maxPairCost: input.config.maxPairCost,
  });
  const pairedIncrease = round(simulated.pairedQty - state.pairedQty);

  if (pairedIncrease !== qty) return false;
  if (targetSide === 'YES') return simulated.unpairedYesQty <= state.unpairedYesQty;
  return simulated.unpairedNoQty <= state.unpairedNoQty;
}

function evaluateHedge(
  input: DecidePairCostStrategyTickInput,
  state: ReturnType<typeof rebuildPairCostInventoryState>,
  targetSide: PairCostSide,
  unpairedLots: InventoryLot[],
): PairCostDecision {
  const qualitySkip = passesMarketQuality(input, state, targetSide);
  if (qualitySkip) return qualitySkip;

  const candidateQty = hedgeQtyFor(input, targetSide, totalQty(unpairedLots));
  if (candidateQty <= 0) {
    return skip(input, state, PairCostSkipReason.DEPTH_TOO_LOW, {
      candidateAction: 'BUY',
      candidateSide: targetSide,
      candidateQty,
    });
  }

  const exec = getExecutableBuyPrice(input.books[targetSide], targetSide, candidateQty);
  const existingAvgCost = averageCostOfLots(unpairedLots, candidateQty);
  const projectedPairCost = round(existingAvgCost + exec.avgPrice);
  const edgePerPair = round(1 - projectedPairCost);
  const candidate = {
    candidateAction: 'BUY' as const,
    candidateSide: targetSide,
    candidateQty,
    candidateExecPrice: exec.avgPrice,
    projectedPairCost,
    edgePerPair,
  };

  if (!exec.enoughDepth || exec.avgPrice <= 0 || exec.worstPrice <= 0) {
    return skip(input, state, PairCostSkipReason.DEPTH_TOO_LOW, candidate);
  }

  if (exec.totalCost > input.config.maxSingleOrderUsd) {
    return skip(input, state, PairCostSkipReason.MAX_MARKET_EXPOSURE_REACHED, candidate);
  }

  const projectedMarketExposure = (input.currentMarketExposureUsd ?? 0) + exec.totalCost;
  if (projectedMarketExposure > input.config.maxTotalMarketExposureUsd) {
    return skip(input, state, PairCostSkipReason.MAX_MARKET_EXPOSURE_REACHED, candidate);
  }

  if (projectedPairCost > input.config.maxPairCost) {
    if (timedOut(input, unpairedLots)) {
      return skip(input, state, PairCostSkipReason.REDUCE_ONLY, candidate, PairCostState.REDUCE_ONLY);
    }
    return skip(input, state, PairCostSkipReason.PAIR_COST_TOO_HIGH, candidate);
  }

  if (edgePerPair < input.config.minEdgePerPair) {
    if (timedOut(input, unpairedLots)) {
      return skip(input, state, PairCostSkipReason.REDUCE_ONLY, candidate, PairCostState.REDUCE_ONLY);
    }
    return skip(input, state, PairCostSkipReason.EDGE_TOO_LOW, candidate);
  }

  if (!simulatedFillKeepsHedgeNeutral(input, state, targetSide, candidateQty, exec.levelsUsed)) {
    return skip(input, state, PairCostSkipReason.PAIR_COST_TOO_HIGH, candidate);
  }

  return {
    decision: 'PLACE_ORDER',
    reason: 'HEDGE_COMPLETION',
    order: {
      marketId: input.marketId,
      action: 'BUY',
      side: targetSide,
      qty: candidateQty,
      limitPrice: exec.worstPrice,
      purpose: 'HEDGE_COMPLETION',
      expectedPairCost: projectedPairCost,
    },
    log: makeLog(input, state, 'PLACE_ORDER', 'HEDGE_COMPLETION', candidate),
  };
}

function evaluateProbe(
  input: DecidePairCostStrategyTickInput,
  state: ReturnType<typeof rebuildPairCostInventoryState>,
): PairCostDecision {
  if (!input.config.probeEnabled || !input.config.allowProbeMode) {
    return skip(input, state, PairCostSkipReason.PROBE_DISABLED);
  }

  if (input.timeToCloseSeconds < input.config.noNewProbeLastSeconds) {
    return skip(input, state, PairCostSkipReason.TIME_TO_CLOSE_TOO_LOW);
  }

  const candidate = input.probeCandidate;
  if (!candidate || candidate.mispricing < input.config.minProbeMispricing) {
    return skip(input, state, PairCostSkipReason.NO_UNPAIRED_INVENTORY);
  }

  if (candidate.qty <= 0 || candidate.limitPrice <= 0) {
    return skip(input, state, PairCostSkipReason.DEPTH_TOO_LOW, {
      candidateAction: 'BUY',
      candidateSide: candidate.side,
      candidateQty: candidate.qty,
      candidateExecPrice: candidate.limitPrice,
    });
  }

  if (worstSpread(input.books) > input.config.maxSpread) {
    return skip(input, state, PairCostSkipReason.SPREAD_TOO_WIDE, {
      candidateAction: 'BUY',
      candidateSide: candidate.side,
      candidateQty: candidate.qty,
      candidateExecPrice: candidate.limitPrice,
    });
  }

  if (input.books[candidate.side].depth3Usd < input.config.minDepthUsd) {
    return skip(input, state, PairCostSkipReason.DEPTH_TOO_LOW, {
      candidateAction: 'BUY',
      candidateSide: candidate.side,
      candidateQty: candidate.qty,
      candidateExecPrice: candidate.limitPrice,
    });
  }

  const notional = round(candidate.qty * candidate.limitPrice);
  if (notional > input.config.maxProbeExposureUsd || notional > input.config.maxUnpairedExposureUsd) {
    return skip(input, state, PairCostSkipReason.MAX_UNPAIRED_EXPOSURE_REACHED, {
      candidateAction: 'BUY',
      candidateSide: candidate.side,
      candidateQty: candidate.qty,
      candidateExecPrice: candidate.limitPrice,
    });
  }

  if (notional > input.config.maxSingleOrderUsd) {
    return skip(input, state, PairCostSkipReason.MAX_MARKET_EXPOSURE_REACHED, {
      candidateAction: 'BUY',
      candidateSide: candidate.side,
      candidateQty: candidate.qty,
      candidateExecPrice: candidate.limitPrice,
    });
  }

  const projectedMarketExposure = (input.currentMarketExposureUsd ?? 0) + notional;
  if (projectedMarketExposure > input.config.maxTotalMarketExposureUsd) {
    return skip(input, state, PairCostSkipReason.MAX_MARKET_EXPOSURE_REACHED, {
      candidateAction: 'BUY',
      candidateSide: candidate.side,
      candidateQty: candidate.qty,
      candidateExecPrice: candidate.limitPrice,
    });
  }

  return {
    decision: 'PLACE_ORDER',
    reason: 'PROBE',
    order: {
      marketId: input.marketId,
      action: 'BUY',
      side: candidate.side,
      qty: candidate.qty,
      limitPrice: candidate.limitPrice,
      purpose: 'PROBE',
      expectedPairCost: null,
    },
    log: makeLog(input, state, 'PLACE_ORDER', 'PROBE', {
      candidateAction: 'BUY',
      candidateSide: candidate.side,
      candidateQty: candidate.qty,
      candidateExecPrice: candidate.limitPrice,
    }),
  };
}

export function decidePairCostStrategyTick(input: DecidePairCostStrategyTickInput): PairCostDecision {
  const state = rebuildPairCostInventoryState({
    marketId: input.marketId,
    lots: input.lots,
    maxPairCost: input.config.maxPairCost,
  });

  if (!input.config.enabled) return skip(input, state, PairCostSkipReason.STRATEGY_DISABLED);
  if (!input.market.enabled || input.market.closed) return skip(input, state, PairCostSkipReason.MARKET_CLOSED);
  if (input.market.resolving) return skip(input, state, PairCostSkipReason.MARKET_RESOLVING);

  const orderbookStale =
    bookIsStale(input.books.YES, input.now, input.config.orderbookStaleMs) ||
    bookIsStale(input.books.NO, input.now, input.config.orderbookStaleMs);

  if (isActive(input.activeOrder)) {
    const orderAgeMs = input.now.getTime() - input.activeOrder!.createdAt.getTime();
    if (orderAgeMs >= input.config.partialFillTimeoutMs || orderbookStale) {
      return {
        decision: 'CANCEL_ORDER',
        reason: PairCostSkipReason.ACTIVE_ORDER_EXISTS,
        order: null,
        cancelOrderId: input.activeOrder!.orderId,
        log: makeLog(input, state, 'CANCEL_ORDER', PairCostSkipReason.ACTIVE_ORDER_EXISTS, {
          candidateAction: input.activeOrder!.action,
          candidateSide: input.activeOrder!.side,
          candidateQty: input.activeOrder!.qty,
          candidateExecPrice: input.activeOrder!.limitPrice,
          projectedPairCost: input.activeOrder!.expectedPairCost,
        }),
      };
    }
    return skip(input, state, PairCostSkipReason.ACTIVE_ORDER_EXISTS);
  }

  if (orderbookStale) {
    return skip(input, state, PairCostSkipReason.ORDERBOOK_STALE);
  }

  if (state.unpairedYesQty > 0 && state.unpairedNoQty > 0) {
    return skip(input, state, PairCostSkipReason.REDUCE_ONLY, {}, PairCostState.REDUCE_ONLY);
  }

  if (state.unpairedYesQty > 0) {
    return evaluateHedge(input, state, 'NO', state.unpairedYesLots);
  }

  if (state.unpairedNoQty > 0) {
    return evaluateHedge(input, state, 'YES', state.unpairedNoLots);
  }

  return evaluateProbe(input, state);
}

export function applyPairCostFillAndManageOrder(input: ApplyPairCostFillInput): ApplyPairCostFillResult {
  const filledLot: InventoryLot = {
    id: `${input.activeOrder.orderId}-fill-${input.fill.timestamp.getTime()}`,
    marketId: input.marketId,
    side: input.activeOrder.side,
    qty: input.fill.qty,
    remainingQty: input.fill.qty,
    price: input.fill.price,
    cost: round(input.fill.qty * input.fill.price),
    timestamp: input.fill.timestamp,
    sourceOrderId: input.activeOrder.orderId,
  };

  const inventoryState = rebuildPairCostInventoryState({
    marketId: input.marketId,
    lots: [...input.lots, filledLot],
    maxPairCost: input.config.maxPairCost,
  });

  const isPartial = input.fill.qty < input.activeOrder.qty;
  const ageMs = input.now.getTime() - input.activeOrder.createdAt.getTime();
  const cancelRemaining = isPartial && ageMs >= input.config.partialFillTimeoutMs;

  return {
    inventoryState,
    order: {
      ...input.activeOrder,
      status: cancelRemaining ? 'CANCELLED' : (isPartial ? 'PARTIAL' : 'FILLED'),
    },
    cancelRemaining,
  };
}
