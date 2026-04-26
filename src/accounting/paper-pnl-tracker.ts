import { FillEvent } from '../simulation/paper-execution-engine';

export interface Position {
  tokenId: string;
  netSize: number; // positive = long, negative = short
  avgCost: number; // average entry price in cents (0-1)
  realizedPnl: number;
  totalBoughtUsd: number;
  totalSoldUsd: number;
  totalVolumeUsd: number;
}

export interface DailySnapshot {
  date: string;
  realizedPnl: number;
  unrealizedPnl: number;
  spreadCapture: number;
  estimatedRebate: number;
  totalTrades: number;
  openPositions: number;
}

export class PaperPnlTracker {
  private positions = new Map<string, Position>();
  private snapshots: DailySnapshot[] = [];
  private dayStartRealized = 0;
  private currentDate = '';

  constructor(private makerRebateRate = 0.005) {}

  onFill(fill: FillEvent, fairPrice: number): void {
    let pos = this.positions.get(fill.tokenId);
    if (!pos) {
      pos = {
        tokenId: fill.tokenId,
        netSize: 0,
        avgCost: 0,
        realizedPnl: 0,
        totalBoughtUsd: 0,
        totalSoldUsd: 0,
        totalVolumeUsd: 0
      };
      this.positions.set(fill.tokenId, pos);
    }

    const fillUsd = fill.filledPrice * fill.filledSize;
    pos.totalVolumeUsd += fillUsd;

    if (fill.side === 'BUY') {
      pos.totalBoughtUsd += fillUsd;
      if (pos.netSize >= 0) {
        // Adding to long
        const totalCost = pos.avgCost * pos.netSize + fill.filledPrice * fill.filledSize;
        pos.netSize += fill.filledSize;
        pos.avgCost = pos.netSize > 0 ? totalCost / pos.netSize : 0;
      } else {
        // Buying to cover short
        const coverSize = Math.min(fill.filledSize, Math.abs(pos.netSize));
        const pnl = (pos.avgCost - fill.filledPrice) * coverSize;
        pos.realizedPnl += pnl;
        pos.netSize += fill.filledSize;
        if (pos.netSize > 0) {
          // Remaining becomes long
          pos.avgCost = fill.filledPrice;
        }
      }
    } else {
      // SELL
      pos.totalSoldUsd += fillUsd;
      if (pos.netSize <= 0) {
        // Adding to short
        const totalCost = pos.avgCost * Math.abs(pos.netSize) + fill.filledPrice * fill.filledSize;
        pos.netSize -= fill.filledSize;
        pos.avgCost = pos.netSize < 0 ? totalCost / Math.abs(pos.netSize) : 0;
      } else {
        // Selling long
        const sellSize = Math.min(fill.filledSize, pos.netSize);
        const pnl = (fill.filledPrice - pos.avgCost) * sellSize;
        pos.realizedPnl += pnl;
        pos.netSize -= fill.filledSize;
        if (pos.netSize < 0) {
          // Remaining becomes short
          pos.avgCost = fill.filledPrice;
        }
      }
    }
  }

  getPosition(tokenId: string): Position | undefined {
    return this.positions.get(tokenId);
  }

  getAllPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  computeUnrealizedPnl(fairPrices: Map<string, number>): number {
    let total = 0;
    for (const [tokenId, pos] of this.positions) {
      if (pos.netSize === 0) continue;
      const fair = fairPrices.get(tokenId);
      if (fair === undefined) continue;
      if (pos.netSize > 0) {
        total += (fair - pos.avgCost) * pos.netSize;
      } else {
        total += (pos.avgCost - fair) * Math.abs(pos.netSize);
      }
    }
    return total;
  }

  computeTotals(fairPrices: Map<string, number>): {
    realizedPnl: number;
    unrealizedPnl: number;
    estimatedRebate: number;
    spreadCapture: number;
    totalTrades: number;
    openPositions: number;
  } {
    let realizedPnl = 0;
    let estimatedRebate = 0;
    let totalTrades = 0;
    let openPositions = 0;

    for (const pos of this.positions.values()) {
      realizedPnl += pos.realizedPnl;
      estimatedRebate += pos.totalVolumeUsd * this.makerRebateRate;
      totalTrades += pos.totalVolumeUsd > 0 ? 1 : 0;
      if (pos.netSize !== 0) openPositions++;
    }

    const unrealizedPnl = this.computeUnrealizedPnl(fairPrices);
    const spreadCapture = realizedPnl; // approximate

    return { realizedPnl, unrealizedPnl, estimatedRebate, spreadCapture, totalTrades, openPositions };
  }

  startNewDay(date: string): void {
    this.currentDate = date;
    this.dayStartRealized = this.getAllPositions().reduce((s, p) => s + p.realizedPnl, 0);
  }

  endDay(date: string, fairPrices: Map<string, number>): DailySnapshot {
    const totals = this.computeTotals(fairPrices);
    const snapshot: DailySnapshot = {
      date,
      realizedPnl: totals.realizedPnl - this.dayStartRealized,
      unrealizedPnl: totals.unrealizedPnl,
      spreadCapture: totals.spreadCapture,
      estimatedRebate: totals.estimatedRebate,
      totalTrades: totals.totalTrades,
      openPositions: totals.openPositions
    };
    this.snapshots.push(snapshot);
    return snapshot;
  }

  getSnapshots(): DailySnapshot[] {
    return this.snapshots;
  }
}
