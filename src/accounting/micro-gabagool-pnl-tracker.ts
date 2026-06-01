export interface PnlConfig {
  gasPerRoundtripEstimateUsd: number;
  makerRebateRate: number;
  initialBalanceUsd: number;
}

export interface ClosedTrade {
  marketId: string;
  entryPrice: number;
  exitPrice: number;
  sizeUsd: number;
  shares: number;
  grossProfitUsd: number;
  gasCostUsd: number;
  rebateUsd: number;
  netProfitUsd: number;
  isTakerExit: boolean;
  holdTimeSeconds: number;
  timestamp: number;
}

export interface PnlSnapshot {
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  dailyPnlUsd: number;
  grossPnlUsd: number;
  netPnlUsd: number;
  gasCostsTotalUsd: number;
  rebatesTotalUsd: number;
  feesPaidTotalUsd: number;
  tradeCount: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  avgHoldTimeSeconds: number;
  avgSpreadCaptured: number;
  makerFillsCount: number;
  takerFillsCount: number;
  forceTakerExitsCount: number;
  currentBalanceUsd: number;
}

export class MicroGabagoolPnlTracker {
  private closedTrades: ClosedTrade[] = [];
  private unrealizedPositions: Map<string, { entryPrice: number; sizeUsd: number; shares: number }> = new Map();
  private balance: number;
  private dayStartMs: number;

  constructor(private config: PnlConfig, nowMs: number = Date.now()) {
    this.balance = config.initialBalanceUsd;
    this.dayStartMs = this.getDayStart(nowMs);
  }

  private getDayStart(nowMs: number): number {
    const d = new Date(nowMs);
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
  }

  recordFill(marketId: string, entryPrice: number, sizeUsd: number, shares: number): void {
    this.unrealizedPositions.set(marketId, { entryPrice, sizeUsd, shares });
    this.balance -= sizeUsd;
  }

  recordExit(
    marketId: string,
    exitPrice: number,
    isTakerExit: boolean,
    holdTimeSeconds: number,
    nowMs: number = Date.now()
  ): ClosedTrade {
    const position = this.unrealizedPositions.get(marketId);
    if (!position) throw new Error(`No position for market ${marketId}`);

    const grossProfitUsd = (exitPrice - position.entryPrice) * position.shares;
    const gasCostUsd = this.config.gasPerRoundtripEstimateUsd;
    const rebateUsd = position.sizeUsd * this.config.makerRebateRate;
    const netProfitUsd = grossProfitUsd - gasCostUsd + rebateUsd;

    const trade: ClosedTrade = {
      marketId,
      entryPrice: position.entryPrice,
      exitPrice,
      sizeUsd: position.sizeUsd,
      shares: position.shares,
      grossProfitUsd,
      gasCostUsd,
      rebateUsd,
      netProfitUsd,
      isTakerExit,
      holdTimeSeconds,
      timestamp: nowMs,
    };

    this.closedTrades.push(trade);
    this.unrealizedPositions.delete(marketId);
    this.balance += position.shares * exitPrice;

    return trade;
  }

  getSnapshot(currentPrices: Map<string, number>, nowMs: number = Date.now()): PnlSnapshot {
    let unrealizedPnlUsd = 0;
    for (const [marketId, position] of this.unrealizedPositions) {
      const currentPrice = currentPrices.get(marketId) ?? position.entryPrice;
      unrealizedPnlUsd += (currentPrice - position.entryPrice) * position.shares;
    }

    const dayStart = this.getDayStart(nowMs);
    const todayTrades = this.closedTrades.filter(t => t.timestamp >= dayStart);
    const dailyPnl = todayTrades.reduce((sum, t) => sum + t.netProfitUsd, 0);

    const wins = this.closedTrades.filter(t => t.netProfitUsd > 0);
    const losses = this.closedTrades.filter(t => t.netProfitUsd <= 0);
    const totalHoldTime = this.closedTrades.reduce((sum, t) => sum + t.holdTimeSeconds, 0);
    const totalSpreadCaptured = this.closedTrades.reduce((sum, t) => sum + (t.exitPrice - t.entryPrice), 0);

    return {
      realizedPnlUsd: this.closedTrades.reduce((sum, t) => sum + t.netProfitUsd, 0),
      unrealizedPnlUsd,
      dailyPnlUsd: dailyPnl,
      grossPnlUsd: this.closedTrades.reduce((sum, t) => sum + t.grossProfitUsd, 0),
      netPnlUsd: this.closedTrades.reduce((sum, t) => sum + t.netProfitUsd, 0),
      gasCostsTotalUsd: this.closedTrades.reduce((sum, t) => sum + t.gasCostUsd, 0),
      rebatesTotalUsd: this.closedTrades.reduce((sum, t) => sum + t.rebateUsd, 0),
      feesPaidTotalUsd: 0,
      tradeCount: this.closedTrades.length,
      winCount: wins.length,
      lossCount: losses.length,
      winRate: this.closedTrades.length > 0 ? wins.length / this.closedTrades.length : 0,
      avgHoldTimeSeconds: this.closedTrades.length > 0 ? totalHoldTime / this.closedTrades.length : 0,
      avgSpreadCaptured: this.closedTrades.length > 0 ? totalSpreadCaptured / this.closedTrades.length : 0,
      makerFillsCount: this.closedTrades.filter(t => !t.isTakerExit).length,
      takerFillsCount: this.closedTrades.filter(t => t.isTakerExit).length,
      forceTakerExitsCount: this.closedTrades.filter(t => t.isTakerExit).length,
      currentBalanceUsd: this.balance + unrealizedPnlUsd,
    };
  }

  getBalance(): number {
    return this.balance;
  }

  getClosedTrades(): ClosedTrade[] {
    return [...this.closedTrades];
  }

  hasPosition(marketId: string): boolean {
    return this.unrealizedPositions.has(marketId);
  }

  getPosition(marketId: string): { entryPrice: number; sizeUsd: number; shares: number } | undefined {
    return this.unrealizedPositions.get(marketId);
  }
}
