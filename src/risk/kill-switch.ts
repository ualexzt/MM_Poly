import { RiskConfig } from '../types/config';

export type KillSwitchState = 'OK' | 'CANCEL_ALL' | 'DISABLE_STRATEGY';

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

export class KillSwitch {
  constructor(private config: Partial<RiskConfig>) {}

  check(ws: WsStatus, api: ApiErrorWindow, drawdown: Drawdown): KillSwitchState {
    if (!ws.connected && ws.disconnectedAt !== null) {
      const seconds = (Date.now() - ws.disconnectedAt) / 1000;
      if (this.config.cancelAllOnWsDisconnectSeconds && seconds >= this.config.cancelAllOnWsDisconnectSeconds) {
        return 'CANCEL_ALL';
      }
    }

    if (api.totalLast60s > 0) {
      const errorRate = (api.errorsLast60s / api.totalLast60s) * 100;
      if (this.config.cancelAllOnApiErrorRatePct && errorRate >= this.config.cancelAllOnApiErrorRatePct) {
        return 'CANCEL_ALL';
      }
    }

    if (this.config.maxDailyDrawdownPct && drawdown.currentDrawdownPct >= this.config.maxDailyDrawdownPct) {
      return 'DISABLE_STRATEGY';
    }

    return 'OK';
  }
}
