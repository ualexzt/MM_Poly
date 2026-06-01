export interface PaperTradeRequest {
  action: 'BUY_YES' | 'BUY_NO';
  entryPrice: number;
  sizeUsd: number;
  timestamp: number;
}

export interface PaperTradeResult {
  id: string;
  action: string;
  entryPrice: number;
  shares: number;
  costUsd: number;
  timestamp: number;
}

export interface OpenTrade extends PaperTradeResult {
  status: 'OPEN';
}

export interface ClosedTrade extends PaperTradeResult {
  status: 'CLOSED';
  exitPrice: number;
  profitUsd: number;
  profitPct: number;
  closedAt: number;
}

export interface PaperEngineConfig {
  initialBalance: number;
  maxPositionUsd?: number;
  maxOpenTrades?: number;
}

export interface PaperEngineStats {
  totalTrades: number;
  openTrades: number;
  closedTrades: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  totalPnlUsd: number;
  avgProfitUsd: number;
  avgLossUsd: number;
  currentBalance: number;
}

export class LatencyArbPaperEngine {
  private config: PaperEngineConfig;
  private openTrades: OpenTrade[] = [];
  private closedTrades: ClosedTrade[] = [];
  private balance: number;
  private tradeIdCounter: number = 0;

  constructor(config: PaperEngineConfig) {
    this.config = config;
    this.balance = config.initialBalance;
  }

  executeTrade(request: PaperTradeRequest): PaperTradeResult {
    // Check position limit
    const currentExposure = this.openTrades.reduce((sum, t) => sum + t.costUsd, 0);
    if (this.config.maxPositionUsd && currentExposure + request.sizeUsd > this.config.maxPositionUsd) {
      throw new Error('Position limit exceeded');
    }
    
    // Check balance
    if (request.sizeUsd > this.balance) {
      throw new Error('Insufficient balance');
    }
    
    // Check max open trades
    if (this.config.maxOpenTrades && this.openTrades.length >= this.config.maxOpenTrades) {
      throw new Error('Max open trades reached');
    }
    
    const id = `paper-${++this.tradeIdCounter}`;
    const shares = request.sizeUsd / request.entryPrice;
    
    const trade: OpenTrade = {
      id,
      action: request.action,
      entryPrice: request.entryPrice,
      shares,
      costUsd: request.sizeUsd,
      timestamp: request.timestamp,
      status: 'OPEN'
    };
    
    this.openTrades.push(trade);
    this.balance -= request.sizeUsd;
    
    return trade;
  }

  resolveTrade(tradeId: string, outcome: 'YES' | 'NO'): void {
    const tradeIndex = this.openTrades.findIndex(t => t.id === tradeId);
    if (tradeIndex === -1) {
      throw new Error(`Trade ${tradeId} not found`);
    }
    
    const trade = this.openTrades[tradeIndex];
    const isWin = (trade.action === 'BUY_YES' && outcome === 'YES') ||
                  (trade.action === 'BUY_NO' && outcome === 'NO');
    
    const exitPrice = isWin ? 1.0 : 0.0;
    const proceeds = trade.shares * exitPrice;
    const profitUsd = proceeds - trade.costUsd;
    const profitPct = (profitUsd / trade.costUsd) * 100;
    
    const closedTrade: ClosedTrade = {
      ...trade,
      status: 'CLOSED',
      exitPrice,
      profitUsd,
      profitPct,
      closedAt: Date.now()
    };
    
    this.openTrades.splice(tradeIndex, 1);
    this.closedTrades.push(closedTrade);
    this.balance += proceeds;
  }

  getOpenTrades(): OpenTrade[] {
    return [...this.openTrades];
  }

  getClosedTrades(): ClosedTrade[] {
    return [...this.closedTrades];
  }

  getStats(): PaperEngineStats {
    const wins = this.closedTrades.filter(t => t.profitUsd > 0);
    const losses = this.closedTrades.filter(t => t.profitUsd <= 0);
    
    return {
      totalTrades: this.closedTrades.length,
      openTrades: this.openTrades.length,
      closedTrades: this.closedTrades.length,
      winCount: wins.length,
      lossCount: losses.length,
      winRate: this.closedTrades.length > 0 ? wins.length / this.closedTrades.length : 0,
      totalPnlUsd: this.closedTrades.reduce((sum, t) => sum + t.profitUsd, 0),
      avgProfitUsd: wins.length > 0 ? wins.reduce((sum, t) => sum + t.profitUsd, 0) / wins.length : 0,
      avgLossUsd: losses.length > 0 ? losses.reduce((sum, t) => sum + t.profitUsd, 0) / losses.length : 0,
      currentBalance: this.balance
    };
  }

  getBalance(): number {
    return this.balance;
  }
}
