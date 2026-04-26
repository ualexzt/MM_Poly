import { Side } from './quote';

export interface StrategyPnlBreakdown {
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  spreadCapturePnl: number;
  estimatedMakerRebatePnl: number;
  estimatedLiquidityRewardPnl: number;
  adverseSelectionLoss: number;
  inventoryMarkToMarketPnl: number;
  settlementPnl: number;
  feesPaid: number;
  slippageCost: number;
}

export interface QuoteDecisionTrace {
  timestampMs: number;
  mode: 'paper' | 'shadow' | 'small_live' | 'disabled';
  conditionId: string;
  tokenId: string;
  side: Side;
  bestBid: number | null;
  bestAsk: number | null;
  midpoint: number | null;
  spreadTicks: number | null;
  fairPrice: number | null;
  microprice: number | null;
  complementFair: number | null;
  lastTradeEma: number | null;
  toxicityScore: number;
  inventoryPct: number;
  inventorySkewCents: number;
  targetPrice?: number;
  targetSizeUsd?: number;
  expectedSpreadCaptureCents?: number;
  expectedRebateScore?: number;
  expectedRewardScore?: number;
  decision: 'quote' | 'skip' | 'cancel' | 'exit_only' | 'disabled_by_risk';
  reason: string;
  riskFlags: string[];
}
