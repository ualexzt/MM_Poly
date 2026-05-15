import { Position } from '../accounting/paper-pnl-tracker';
import { BookState } from '../types/book';

export type RiskStatus = 'OK' | 'WATCH' | 'WARNING' | 'CRITICAL';
export type PositionSide = 'LONG' | 'SHORT' | 'FLAT';
export type StrategyMode = 'paper' | 'shadow' | 'small_live' | 'disabled';

export interface StrategyRiskConfig {
  softInventoryLimitPct: number;
  reduceOnlyLimitPct: number;
  hardInventoryLimitPct: number;
  maxMarketExposureContracts: number;
  concentrationWarningPct: number;
  concentrationCriticalPctLive: number;
}

export interface StrategyRiskInput {
  mode: StrategyMode;
  conditionId: string;
  tokenId: string;
  position: Position | undefined;
  book: BookState | undefined;
  currentFair: number | null;
  primaryMarketQuoteSharePct: number | null;
  hasActiveQuotes: boolean;
  isBookStale: boolean;
  killSwitchActive: boolean;
}

export interface MarketRiskDecision {
  conditionId: string;
  tokenId: string;
  riskStatus: RiskStatus;
  reasons: string[];
  reduceOnly: boolean;
  allowBuy: boolean;
  allowSell: boolean;
  inventoryUsagePct: number | null;
  netPosition: number;
  positionSide: PositionSide;
  avgEntryPrice: number | null;
  currentFair: number | null;
  currentBid: number | null;
  currentAsk: number | null;
  fairUnrealizedPnl: number;
  exitPnlAtBestBidAsk: number | null;
  worstCaseLossToZero: number | null;
  worstCaseLossToOne: number | null;
}

const STATUS_RANK: Record<RiskStatus, number> = {
  OK: 0,
  WATCH: 1,
  WARNING: 2,
  CRITICAL: 3,
};

export function maxRiskStatus(statuses: RiskStatus[]): RiskStatus {
  return statuses.reduce<RiskStatus>(
    (max, status) => (STATUS_RANK[status] > STATUS_RANK[max] ? status : max),
    'OK'
  );
}

export class StrategyRiskManager {
  constructor(private config: StrategyRiskConfig) {}

  evaluateMarket(input: StrategyRiskInput): MarketRiskDecision {
    const netPosition = input.position?.netSize ?? 0;
    const absPosition = Math.abs(netPosition);
    const positionSide = this.getPositionSide(netPosition);
    const avgEntryPrice = input.position && netPosition !== 0 ? input.position.avgCost : null;
    const inventoryUsagePct = this.computeInventoryUsagePct(absPosition);

    const reasons: string[] = [];
    let reduceOnly = false;
    let allowBuy = true;
    let allowSell = true;

    if (inventoryUsagePct !== null && inventoryUsagePct >= this.config.softInventoryLimitPct) {
      reasons.push('inventory_soft_limit_exceeded');
    }

    if (inventoryUsagePct !== null && inventoryUsagePct >= this.config.reduceOnlyLimitPct) {
      reduceOnly = true;
      if (netPosition < 0) {
        allowSell = false;
        reasons.push('reduce_only_short_inventory');
      } else if (netPosition > 0) {
        allowBuy = false;
        reasons.push('reduce_only_long_inventory');
      }
    }

    if (inventoryUsagePct !== null && inventoryUsagePct > this.config.hardInventoryLimitPct) {
      reasons.push('inventory_hard_limit_exceeded');
    }

    if (
      input.primaryMarketQuoteSharePct !== null &&
      input.primaryMarketQuoteSharePct > this.config.concentrationWarningPct
    ) {
      reasons.push('single_market_concentration_warning');
    }

    if (
      input.mode === 'small_live' &&
      input.primaryMarketQuoteSharePct !== null &&
      input.primaryMarketQuoteSharePct > this.config.concentrationCriticalPctLive
    ) {
      reasons.push('single_market_concentration_critical');
    }

    if (input.isBookStale && input.hasActiveQuotes) {
      allowBuy = false;
      allowSell = false;
      reasons.push('stale_book_with_active_quotes');
    }

    if (input.killSwitchActive) {
      allowBuy = false;
      allowSell = false;
      reasons.push('kill_switch_active');
    }

    return {
      conditionId: input.conditionId,
      tokenId: input.tokenId,
      riskStatus: this.computeRiskStatus(reasons, inventoryUsagePct),
      reasons,
      reduceOnly,
      allowBuy,
      allowSell,
      inventoryUsagePct,
      netPosition,
      positionSide,
      avgEntryPrice,
      currentFair: input.currentFair,
      currentBid: input.book?.bestBid ?? null,
      currentAsk: input.book?.bestAsk ?? null,
      fairUnrealizedPnl: this.computeFairUnrealizedPnl(netPosition, avgEntryPrice, input.currentFair),
      exitPnlAtBestBidAsk: this.computeExitPnlAtBestBidAsk(netPosition, avgEntryPrice, input.book),
      worstCaseLossToZero: positionSide === 'LONG' && avgEntryPrice !== null ? absPosition * avgEntryPrice : null,
      worstCaseLossToOne: positionSide === 'SHORT' && avgEntryPrice !== null ? absPosition * (1 - avgEntryPrice) : null,
    };
  }

  private computeInventoryUsagePct(absPosition: number): number | null {
    if (this.config.maxMarketExposureContracts <= 0) return null;
    return (absPosition / this.config.maxMarketExposureContracts) * 100;
  }

  private getPositionSide(netPosition: number): PositionSide {
    if (netPosition > 0) return 'LONG';
    if (netPosition < 0) return 'SHORT';
    return 'FLAT';
  }

  private computeFairUnrealizedPnl(
    netPosition: number,
    avgEntryPrice: number | null,
    currentFair: number | null
  ): number {
    if (netPosition === 0 || avgEntryPrice === null || currentFair === null) return 0;
    if (netPosition > 0) return netPosition * (currentFair - avgEntryPrice);
    return Math.abs(netPosition) * (avgEntryPrice - currentFair);
  }

  private computeExitPnlAtBestBidAsk(
    netPosition: number,
    avgEntryPrice: number | null,
    book: BookState | undefined
  ): number | null {
    if (netPosition === 0 || avgEntryPrice === null || !book) return null;
    if (netPosition > 0) {
      if (book.bestBid === null) return null;
      return netPosition * (book.bestBid - avgEntryPrice);
    }
    if (book.bestAsk === null) return null;
    return Math.abs(netPosition) * (avgEntryPrice - book.bestAsk);
  }

  private computeRiskStatus(reasons: string[], inventoryUsagePct: number | null): RiskStatus {
    if (
      reasons.includes('kill_switch_active') ||
      reasons.includes('stale_book_with_active_quotes') ||
      reasons.includes('inventory_hard_limit_exceeded') ||
      reasons.includes('single_market_concentration_critical')
    ) {
      return 'CRITICAL';
    }

    if (reasons.includes('single_market_concentration_warning')) {
      return 'WARNING';
    }

    if (inventoryUsagePct !== null && inventoryUsagePct >= this.config.reduceOnlyLimitPct) {
      return 'WARNING';
    }

    if (inventoryUsagePct !== null && inventoryUsagePct >= this.config.softInventoryLimitPct) {
      return 'WATCH';
    }

    return 'OK';
  }
}
