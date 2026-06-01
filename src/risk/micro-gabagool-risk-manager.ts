export interface RiskManagerConfig {
  maxDailyLossUsd: number;
  maxTotalExposureUsd: number;
  maxPositionPerMarketUsd: number;
  maxActiveMarkets: number;
  consecutiveLossLimit: number;
  marketCooldownAfterLossMinutes: number;
  marketCooldownAfterTwoBadExitsMinutes: number;
}

export interface TradeResult {
  marketId: string;
  profitUsd: number;
  timestamp: number;
}

export interface RiskCheckResult {
  allowed: boolean;
  reason?: string;
}

export type KillSwitchState = 'ACTIVE' | 'DAILY_STOP' | 'CONSECUTIVE_LOSS_FREEZE' | 'SAFE_MODE';

export class MicroGabagoolRiskManager {
  private dailyPnl: number = 0;
  private consecutiveLosses: number = 0;
  private activeMarkets: Map<string, number> = new Map(); // marketId -> exposure
  private cooldowns: Map<string, number> = new Map(); // marketId -> cooldownUntil
  private badExitCounts: Map<string, number> = new Map(); // marketId -> count
  private killSwitchState: KillSwitchState = 'ACTIVE';
  private dayStartMs: number;

  constructor(private config: RiskManagerConfig, nowMs: number = Date.now()) {
    this.dayStartMs = this.getDayStart(nowMs);
  }

  private getDayStart(nowMs: number): number {
    const d = new Date(nowMs);
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
  }

  canEnterMarket(marketId: string, orderSizeUsd: number, nowMs: number = Date.now()): RiskCheckResult {
    if (this.killSwitchState !== 'ACTIVE') {
      return { allowed: false, reason: `kill_switch_${this.killSwitchState.toLowerCase()}` };
    }

    if (this.dailyPnl <= -this.config.maxDailyLossUsd) {
      return { allowed: false, reason: 'daily_loss_limit' };
    }

    const currentExposure = this.getTotalExposure();
    if (currentExposure + orderSizeUsd > this.config.maxTotalExposureUsd) {
      return { allowed: false, reason: 'total_exposure_limit' };
    }

    if (this.activeMarkets.size >= this.config.maxActiveMarkets && !this.activeMarkets.has(marketId)) {
      return { allowed: false, reason: 'max_active_markets' };
    }

    const marketExposure = this.activeMarkets.get(marketId) ?? 0;
    if (marketExposure + orderSizeUsd > this.config.maxPositionPerMarketUsd) {
      return { allowed: false, reason: 'market_exposure_limit' };
    }

    const cooldownUntil = this.cooldowns.get(marketId);
    if (cooldownUntil && nowMs < cooldownUntil) {
      return { allowed: false, reason: 'market_in_cooldown' };
    }

    return { allowed: true };
  }

  recordTrade(result: TradeResult, nowMs: number = Date.now()): void {
    this.dailyPnl += result.profitUsd;

    if (result.profitUsd < 0) {
      this.consecutiveLosses++;
      this.startCooldown(result.marketId, 'loss', nowMs);

      if (this.consecutiveLosses >= this.config.consecutiveLossLimit) {
        this.killSwitchState = 'CONSECUTIVE_LOSS_FREEZE';
      }
    } else {
      this.consecutiveLosses = 0;
    }

    if (this.dailyPnl <= -this.config.maxDailyLossUsd) {
      this.killSwitchState = 'DAILY_STOP';
    }
  }

  addExposure(marketId: string, sizeUsd: number): void {
    const current = this.activeMarkets.get(marketId) ?? 0;
    this.activeMarkets.set(marketId, current + sizeUsd);
  }

  removeExposure(marketId: string, sizeUsd: number): void {
    const current = this.activeMarkets.get(marketId) ?? 0;
    const newExposure = current - sizeUsd;
    if (newExposure <= 0) {
      this.activeMarkets.delete(marketId);
    } else {
      this.activeMarkets.set(marketId, newExposure);
    }
  }

  recordBadExit(marketId: string, nowMs: number = Date.now()): void {
    const count = (this.badExitCounts.get(marketId) ?? 0) + 1;
    this.badExitCounts.set(marketId, count);

    if (count >= 2) {
      this.startCooldown(marketId, 'two_bad_exits', nowMs);
    }
  }

  private startCooldown(marketId: string, reason: string, nowMs: number): void {
    const durationMs = reason === 'two_bad_exits'
      ? this.config.marketCooldownAfterTwoBadExitsMinutes * 60_000
      : this.config.marketCooldownAfterLossMinutes * 60_000;
    this.cooldowns.set(marketId, nowMs + durationMs);
  }

  getTotalExposure(): number {
    let total = 0;
    for (const exposure of this.activeMarkets.values()) {
      total += exposure;
    }
    return total;
  }

  getDailyPnl(): number {
    return this.dailyPnl;
  }

  getConsecutiveLosses(): number {
    return this.consecutiveLosses;
  }

  getKillSwitchState(): KillSwitchState {
    return this.killSwitchState;
  }

  getActiveMarketsCount(): number {
    return this.activeMarkets.size;
  }

  resetDaily(nowMs: number = Date.now()): void {
    const dayStart = this.getDayStart(nowMs);
    if (dayStart > this.dayStartMs) {
      this.dailyPnl = 0;
      this.dayStartMs = dayStart;
      if (this.killSwitchState === 'DAILY_STOP') {
        this.killSwitchState = 'ACTIVE';
      }
    }
  }

  manualUnlock(): void {
    this.killSwitchState = 'ACTIVE';
    this.consecutiveLosses = 0;
  }

  enterSafeMode(): void {
    this.killSwitchState = 'SAFE_MODE';
  }
}
