import { StrategyPnlBreakdown } from '../types/accounting';

export interface PnlState {
  realizedPnl: number;
  unrealizedPnl: number;
  spreadCapturePnl: number;
  estimatedMakerRebatePnl: number;
  estimatedLiquidityRewardPnl: number;
  adverseSelectionLoss: number;
  inventoryMarkToMarketPnl: number;
  settlementPnl: number;
  feesPaid: number;
  slippageCost: number;
}

export function computePnlBreakdown(state: PnlState): StrategyPnlBreakdown {
  return {
    ...state,
    totalPnl: state.realizedPnl + state.unrealizedPnl
  };
}
