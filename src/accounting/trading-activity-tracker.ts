import { FillEvent } from '../simulation/paper-execution-engine';

export type QuoteSkipReason =
  | 'staleBookSkipped'
  | 'invalidBookSkipped'
  | 'invalidFairSkipped'
  | 'cooldownSkipped'
  | 'quoteEngineNullSkipped'
  | 'unchangedSkipped';

export interface TradingActivitySnapshot {
  fillsTotal: number;
  buyFills: number;
  sellFills: number;
  buyContracts: number;
  sellContracts: number;
  totalContracts: number;
  buyNotional: number;
  sellNotional: number;
  notionalVolume: number;
  avgFillPrice: number | null;
  quoteTraces: number;
  quoteGeneratedCount: number;
  quoteRejectedCount: number;
  quoteSkippedCount: number;
  staleBookSkippedCount: number;
  invalidBookSkippedCount: number;
  invalidFairSkippedCount: number;
  cooldownSkippedCount: number;
  quoteEngineNullSkippedCount: number;
  unchangedSkippedCount: number;
  activeMarkets: number;
  primaryMarketConditionId: string | null;
  primaryMarketQuoteTraces: number;
  primaryMarketQuoteSharePct: number | null;
}

interface MarketActivity {
  fills: number;
  quoteTraces: number;
}

export class TradingActivityTracker {
  private fillsTotal = 0;
  private buyFills = 0;
  private sellFills = 0;
  private buyContracts = 0;
  private sellContracts = 0;
  private buyNotional = 0;
  private sellNotional = 0;
  private quoteGeneratedCount = 0;
  private quoteRejectedCount = 0;
  private staleBookSkippedCount = 0;
  private invalidBookSkippedCount = 0;
  private invalidFairSkippedCount = 0;
  private cooldownSkippedCount = 0;
  private quoteEngineNullSkippedCount = 0;
  private unchangedSkippedCount = 0;
  private marketActivity = new Map<string, MarketActivity>();

  recordFill(conditionId: string, fill: FillEvent): void {
    const notional = fill.filledPrice * fill.filledSize;

    this.fillsTotal += 1;
    if (fill.side === 'BUY') {
      this.buyFills += 1;
      this.buyContracts += fill.filledSize;
      this.buyNotional += notional;
    } else {
      this.sellFills += 1;
      this.sellContracts += fill.filledSize;
      this.sellNotional += notional;
    }

    this.getMarketActivity(conditionId).fills += 1;
  }

  recordQuoteGenerated(conditionId: string): void {
    this.quoteGeneratedCount += 1;
    this.getMarketActivity(conditionId).quoteTraces += 1;
  }

  recordQuoteRejected(conditionId: string): void {
    this.quoteRejectedCount += 1;
    this.getMarketActivity(conditionId).quoteTraces += 1;
  }

  recordQuoteSkipped(conditionId: string, reason: QuoteSkipReason): void {
    this.incrementSkipCounter(reason);
    this.getMarketActivity(conditionId).quoteTraces += 1;
  }

  snapshot(): TradingActivitySnapshot {
    const totalContracts = this.buyContracts + this.sellContracts;
    const notionalVolume = this.buyNotional + this.sellNotional;
    const quoteSkippedCount =
      this.staleBookSkippedCount +
      this.invalidBookSkippedCount +
      this.invalidFairSkippedCount +
      this.cooldownSkippedCount +
      this.quoteEngineNullSkippedCount +
      this.unchangedSkippedCount;
    const quoteTraces = this.quoteGeneratedCount + this.quoteRejectedCount + quoteSkippedCount;
    const primaryMarket = this.getPrimaryMarket();

    return {
      fillsTotal: this.fillsTotal,
      buyFills: this.buyFills,
      sellFills: this.sellFills,
      buyContracts: this.buyContracts,
      sellContracts: this.sellContracts,
      totalContracts,
      buyNotional: this.buyNotional,
      sellNotional: this.sellNotional,
      notionalVolume,
      avgFillPrice: totalContracts > 0 ? notionalVolume / totalContracts : null,
      quoteTraces,
      quoteGeneratedCount: this.quoteGeneratedCount,
      quoteRejectedCount: this.quoteRejectedCount,
      quoteSkippedCount,
      staleBookSkippedCount: this.staleBookSkippedCount,
      invalidBookSkippedCount: this.invalidBookSkippedCount,
      invalidFairSkippedCount: this.invalidFairSkippedCount,
      cooldownSkippedCount: this.cooldownSkippedCount,
      quoteEngineNullSkippedCount: this.quoteEngineNullSkippedCount,
      unchangedSkippedCount: this.unchangedSkippedCount,
      activeMarkets: this.marketActivity.size,
      primaryMarketConditionId: primaryMarket?.conditionId ?? null,
      primaryMarketQuoteTraces: primaryMarket?.quoteTraces ?? 0,
      primaryMarketQuoteSharePct: primaryMarket && quoteTraces > 0 ? (primaryMarket.quoteTraces / quoteTraces) * 100 : null,
    };
  }

  private incrementSkipCounter(reason: QuoteSkipReason): void {
    switch (reason) {
      case 'staleBookSkipped':
        this.staleBookSkippedCount += 1;
        return;
      case 'invalidBookSkipped':
        this.invalidBookSkippedCount += 1;
        return;
      case 'invalidFairSkipped':
        this.invalidFairSkippedCount += 1;
        return;
      case 'cooldownSkipped':
        this.cooldownSkippedCount += 1;
        return;
      case 'quoteEngineNullSkipped':
        this.quoteEngineNullSkippedCount += 1;
        return;
      case 'unchangedSkipped':
        this.unchangedSkippedCount += 1;
        return;
    }
  }

  private getMarketActivity(conditionId: string): MarketActivity {
    const existing = this.marketActivity.get(conditionId);
    if (existing) return existing;

    const created: MarketActivity = { fills: 0, quoteTraces: 0 };
    this.marketActivity.set(conditionId, created);
    return created;
  }

  private getPrimaryMarket(): { conditionId: string; quoteTraces: number } | null {
    let primaryMarket: { conditionId: string; quoteTraces: number } | null = null;

    for (const [conditionId, activity] of this.marketActivity) {
      if (!primaryMarket || activity.quoteTraces >= primaryMarket.quoteTraces) {
        primaryMarket = { conditionId, quoteTraces: activity.quoteTraces };
      }
    }

    return primaryMarket;
  }
}
