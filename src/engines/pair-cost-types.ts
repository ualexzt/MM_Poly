export type PairCostSide = 'YES' | 'NO';
export type PairCostAction = 'BUY' | 'SELL';

export enum PairCostState {
  IDLE = 'IDLE',
  HAS_UNPAIRED_YES = 'HAS_UNPAIRED_YES',
  HAS_UNPAIRED_NO = 'HAS_UNPAIRED_NO',
  PAIRING_IN_PROGRESS = 'PAIRING_IN_PROGRESS',
  LOCKED_PAIR = 'LOCKED_PAIR',
  REDUCE_ONLY = 'REDUCE_ONLY',
  STOPPED = 'STOPPED',
}

export enum PairCostSkipReason {
  STRATEGY_DISABLED = 'STRATEGY_DISABLED',
  MARKET_CLOSED = 'MARKET_CLOSED',
  MARKET_RESOLVING = 'MARKET_RESOLVING',
  ORDERBOOK_STALE = 'ORDERBOOK_STALE',
  SPREAD_TOO_WIDE = 'SPREAD_TOO_WIDE',
  DEPTH_TOO_LOW = 'DEPTH_TOO_LOW',
  TIME_TO_CLOSE_TOO_LOW = 'TIME_TO_CLOSE_TOO_LOW',
  NO_UNPAIRED_INVENTORY = 'NO_UNPAIRED_INVENTORY',
  PAIR_COST_TOO_HIGH = 'PAIR_COST_TOO_HIGH',
  EDGE_TOO_LOW = 'EDGE_TOO_LOW',
  MAX_MARKET_EXPOSURE_REACHED = 'MAX_MARKET_EXPOSURE_REACHED',
  MAX_UNPAIRED_EXPOSURE_REACHED = 'MAX_UNPAIRED_EXPOSURE_REACHED',
  ACTIVE_ORDER_EXISTS = 'ACTIVE_ORDER_EXISTS',
  PROBE_DISABLED = 'PROBE_DISABLED',
  PROBE_TIMEOUT = 'PROBE_TIMEOUT',
  REDUCE_ONLY = 'REDUCE_ONLY',
}

export interface PairCostStrategyConfig {
  enabled: boolean;
  maxPairCost: number;
  targetPairCost: number;
  minEdgePerPair: number;
  maxTotalMarketExposureUsd: number;
  maxUnpairedExposureUsd: number;
  maxSingleOrderUsd: number;
  maxSingleOrderQty: number | null;
  maxUnpairedHoldSeconds: number;
  noNewPairLastSeconds: number;
  noNewProbeLastSeconds: number;
  partialFillTimeoutMs: number;
  cancelReplaceCooldownMs: number;
  maxSpread: number;
  minDepthUsd: number;
  orderbookStaleMs: number;
  orderMode: 'POST_ONLY' | 'IOC';
  allowTakerForHedgeCompletion: boolean;
  allowProbeMode: boolean;
  probeEnabled: boolean;
  maxProbeExposureUsd: number;
  minProbeMispricing: number;
  maxProbeHoldSeconds: number;
  reduceOnlyOnTimeout: boolean;
  stopOnMarketResolutionRisk: boolean;
  stopOnOrderbookStale: boolean;
}

export const DEFAULT_PAIR_COST_STRATEGY_CONFIG: PairCostStrategyConfig = {
  enabled: false,
  maxPairCost: 0.985,
  targetPairCost: 0.980,
  minEdgePerPair: 0.015,
  maxTotalMarketExposureUsd: 3.00,
  maxUnpairedExposureUsd: 1.00,
  maxSingleOrderUsd: 1.00,
  maxSingleOrderQty: null,
  maxUnpairedHoldSeconds: 30,
  noNewPairLastSeconds: 60,
  noNewProbeLastSeconds: 120,
  partialFillTimeoutMs: 1500,
  cancelReplaceCooldownMs: 1000,
  maxSpread: 0.04,
  minDepthUsd: 2.00,
  orderbookStaleMs: 1500,
  orderMode: 'POST_ONLY',
  allowTakerForHedgeCompletion: false,
  allowProbeMode: false,
  probeEnabled: false,
  maxProbeExposureUsd: 0.50,
  minProbeMispricing: 0.04,
  maxProbeHoldSeconds: 20,
  reduceOnlyOnTimeout: true,
  stopOnMarketResolutionRisk: true,
  stopOnOrderbookStale: true,
};

export interface InventoryLot {
  id: string;
  marketId: string;
  side: PairCostSide;
  qty: number;
  remainingQty: number;
  price: number;
  cost: number;
  timestamp: Date;
  sourceOrderId: string | null;
}

export interface PairedLot {
  marketId: string;
  qty: number;
  yesLotId: string;
  noLotId: string;
  yesPrice: number;
  noPrice: number;
  pairCost: number;
  edgePerPair: number;
  lockedProfit: number;
}

export interface PairCostInventoryState {
  marketId: string;
  yesLots: InventoryLot[];
  noLots: InventoryLot[];
  profitablePairs: PairedLot[];
  unpairedYesLots: InventoryLot[];
  unpairedNoLots: InventoryLot[];
  pairedQty: number;
  unpairedYesQty: number;
  unpairedNoQty: number;
  lockedProfit: number;
  state: PairCostState;
}

export type PairCostOrderPurpose = 'HEDGE_COMPLETION' | 'PROBE' | 'REDUCE_ONLY';
export type PairCostOrderStatus = 'OPEN' | 'PARTIAL' | 'FILLED' | 'CANCELLED' | 'EXPIRED' | 'FAILED';

export interface PairCostStrategyOrder {
  orderId: string;
  marketId: string;
  side: PairCostSide;
  action: PairCostAction;
  qty: number;
  limitPrice: number;
  createdAt: Date;
  purpose: PairCostOrderPurpose;
  expectedPairCost: number | null;
  status: PairCostOrderStatus;
}

export type PairCostDecisionReason = PairCostSkipReason | 'HEDGE_COMPLETION' | 'PROBE';

export interface PairCostDecisionLog {
  timestamp: string;
  marketId: string;
  strategy: 'pair_cost';
  state: PairCostState;
  yesQty: number;
  noQty: number;
  pairedQty: number;
  unpairedYesQty: number;
  unpairedNoQty: number;
  lockedProfit: number;
  candidateAction: PairCostAction | null;
  candidateSide: PairCostSide | null;
  candidateQty: number | null;
  candidateExecPrice: number | null;
  projectedPairCost: number | null;
  edgePerPair: number | null;
  decision: 'PLACE_ORDER' | 'SKIP' | 'CANCEL_ORDER';
  reason: PairCostDecisionReason;
}

export interface PairCostDecision {
  decision: 'PLACE_ORDER' | 'SKIP' | 'CANCEL_ORDER';
  reason: PairCostDecisionReason;
  order: Omit<PairCostStrategyOrder, 'orderId' | 'createdAt' | 'status'> | null;
  cancelOrderId?: string | null;
  log: PairCostDecisionLog;
}
