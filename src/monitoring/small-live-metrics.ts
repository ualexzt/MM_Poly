export interface SmallLiveMetricsSnapshot {
  liveSubmits: number;
  matchedSubmits: number;
  rejects: Record<string, number>;
  alerts: Record<string, number>;
  maxCycleLagMs: number;
}

export class SmallLiveMetrics {
  private data: SmallLiveMetricsSnapshot = emptySnapshot();

  recordSubmit(status: 'live' | 'matched'): void {
    if (status === 'live') {
      this.data.liveSubmits += 1;
      return;
    }

    this.data.matchedSubmits += 1;
  }

  recordReject(reason: string): void {
    this.data.rejects[reason] = (this.data.rejects[reason] ?? 0) + 1;
  }

  recordAlert(reason: string): void {
    this.data.alerts[reason] = (this.data.alerts[reason] ?? 0) + 1;
  }

  recordCycleLag(ms: number): void {
    this.data.maxCycleLagMs = Math.max(this.data.maxCycleLagMs, ms);
  }

  snapshot(): SmallLiveMetricsSnapshot {
    return {
      liveSubmits: this.data.liveSubmits,
      matchedSubmits: this.data.matchedSubmits,
      rejects: { ...this.data.rejects },
      alerts: { ...this.data.alerts },
      maxCycleLagMs: this.data.maxCycleLagMs,
    };
  }

  reset(): SmallLiveMetricsSnapshot {
    const snapshot = this.snapshot();
    this.data = emptySnapshot();
    return snapshot;
  }
}

function emptySnapshot(): SmallLiveMetricsSnapshot {
  return {
    liveSubmits: 0,
    matchedSubmits: 0,
    rejects: {},
    alerts: {},
    maxCycleLagMs: 0,
  };
}
