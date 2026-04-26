import { computePnlBreakdown } from '../../src/accounting/pnl-attribution';

describe('pnl-attribution', () => {
  test('returns zero PnL for empty state', () => {
    const pnl = computePnlBreakdown({
      realizedPnl: 0, unrealizedPnl: 0,
      spreadCapturePnl: 0, estimatedMakerRebatePnl: 0,
      estimatedLiquidityRewardPnl: 0, adverseSelectionLoss: 0,
      inventoryMarkToMarketPnl: 0, settlementPnl: 0,
      feesPaid: 0, slippageCost: 0
    });
    expect(pnl.totalPnl).toBe(0);
  });

  test('totals realized and unrealized', () => {
    const pnl = computePnlBreakdown({
      realizedPnl: 10, unrealizedPnl: -3,
      spreadCapturePnl: 10, estimatedMakerRebatePnl: 0,
      estimatedLiquidityRewardPnl: 0, adverseSelectionLoss: -2,
      inventoryMarkToMarketPnl: -1, settlementPnl: 0,
      feesPaid: -1, slippageCost: 0
    });
    expect(pnl.totalPnl).toBe(7);
  });
});
