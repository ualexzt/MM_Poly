import { RiskConfig } from '../types/config';

export type KillSwitchState = 'OK' | 'CANCEL_ALL' | 'DISABLE_STRATEGY' | 'CANCEL_MARKET';

export interface WsStatus {
  connected: boolean;
  disconnectedAt: number | null;
}

export interface ApiErrorWindow {
  errorsLast60s: number;
  totalLast60s: number;
}

export interface Drawdown {
  currentDrawdownPct: number;
}

export interface KillSwitchCheckResult {
  state: KillSwitchState;
  reason?: string;
}

export class KillSwitch {
  private consecutiveAdverseFills = 0;

  constructor(private config: Partial<RiskConfig>) {}

  /**
   * Global kill-switch check (§13.2):
   *  - ws_disconnected       → CANCEL_ALL
   *  - api_error_rate_high   → CANCEL_ALL
   *  - daily_drawdown        → DISABLE_STRATEGY
   *  - consecutive_adverse_fills → CANCEL_MARKET (caller picks the market)
   */
  check(ws: WsStatus, api: ApiErrorWindow, drawdown: Drawdown): KillSwitchState {
    // WS disconnect (§13.2)
    if (!ws.connected && ws.disconnectedAt !== null) {
      const seconds = (Date.now() - ws.disconnectedAt) / 1000;
      if (this.config.cancelAllOnWsDisconnectSeconds != null &&
          seconds >= this.config.cancelAllOnWsDisconnectSeconds) {
        return 'CANCEL_ALL';
      }
    }

    // API error rate (§13.2)
    if (api.totalLast60s > 0) {
      const errorRate = (api.errorsLast60s / api.totalLast60s) * 100;
      if (this.config.cancelAllOnApiErrorRatePct != null &&
          errorRate >= this.config.cancelAllOnApiErrorRatePct) {
        return 'CANCEL_ALL';
      }
    }

    // Daily drawdown (§13.2)
    if (this.config.maxDailyDrawdownPct != null &&
        drawdown.currentDrawdownPct >= this.config.maxDailyDrawdownPct) {
      return 'DISABLE_STRATEGY';
    }

    // Consecutive adverse fills (§13.2)
    if (this.config.maxConsecutiveAdverseFills != null &&
        this.consecutiveAdverseFills >= this.config.maxConsecutiveAdverseFills) {
      return 'CANCEL_MARKET';
    }

    return 'OK';
  }

  /** Call after each fill classification (§13.3) */
  recordFill(isAdverse: boolean): void {
    if (isAdverse) {
      this.consecutiveAdverseFills++;
    } else {
      this.consecutiveAdverseFills = 0;
    }
  }

  resetAdverseFills(): void {
    this.consecutiveAdverseFills = 0;
  }

  getConsecutiveAdverseFills(): number {
    return this.consecutiveAdverseFills;
  }
}

/**
 * Checks if market is within the near-resolution disable window (§13.2).
 */
export function isNearResolution(endDate: string | undefined, disableWindowMinutes: number): boolean {
  if (!endDate) return false;
  const minutesToEnd = (new Date(endDate).getTime() - Date.now()) / 60000;
  return minutesToEnd < disableWindowMinutes;
}

/**
 * Tick-size-change guard — must cancel all market orders when triggered (§13.2).
 */
export function hasTickSizeChanged(currentTickSize: number, previousTickSize: number): boolean {
  return Math.abs(currentTickSize - previousTickSize) > 1e-10;
}
