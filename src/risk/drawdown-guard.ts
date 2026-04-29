/**
 * Drawdown Guard — §13.2
 * Tracks realized PnL vs session start to detect daily/strategy drawdown.
 */

export interface DrawdownConfig {
  maxDailyDrawdownPct: number;   // e.g. 2 → 2%
  maxStrategyDrawdownPct: number; // e.g. 5 → 5%
}

export class DrawdownGuard {
  private sessionStartCapital: number;
  private dayStartCapital: number;
  private currentCapital: number;

  constructor(private config: DrawdownConfig, initialCapital: number) {
    this.sessionStartCapital = initialCapital;
    this.dayStartCapital = initialCapital;
    this.currentCapital = initialCapital;
  }

  update(currentCapital: number): void {
    this.currentCapital = currentCapital;
  }

  startNewDay(): void {
    this.dayStartCapital = this.currentCapital;
  }

  getDailyDrawdownPct(): number {
    if (this.dayStartCapital <= 0) return 0;
    const loss = this.dayStartCapital - this.currentCapital;
    return Math.max(0, (loss / this.dayStartCapital) * 100);
  }

  getStrategyDrawdownPct(): number {
    if (this.sessionStartCapital <= 0) return 0;
    const loss = this.sessionStartCapital - this.currentCapital;
    return Math.max(0, (loss / this.sessionStartCapital) * 100);
  }

  isDailyLimitBreached(): boolean {
    return this.getDailyDrawdownPct() >= this.config.maxDailyDrawdownPct;
  }

  isStrategyLimitBreached(): boolean {
    return this.getStrategyDrawdownPct() >= this.config.maxStrategyDrawdownPct;
  }

  getStatus(): { dailyPct: number; strategyPct: number; dailyBreached: boolean; strategyBreached: boolean } {
    return {
      dailyPct: this.getDailyDrawdownPct(),
      strategyPct: this.getStrategyDrawdownPct(),
      dailyBreached: this.isDailyLimitBreached(),
      strategyBreached: this.isStrategyLimitBreached(),
    };
  }
}
