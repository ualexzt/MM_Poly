export interface PricePoint {
  price: number;
  timestamp: number;
  volume: number;
}

export interface MomentumConfig {
  lookbackSeconds: number;
  minPriceChangePct: number;
  minVolumeMultiplier: number;
  emaFastPeriod: number;
  emaSlowPeriod: number;
}

export type MomentumDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export interface MomentumSignal {
  direction: MomentumDirection;
  strength: number; // 0-1
  priceChangePct: number;
  volumeConfirmed: boolean;
  emaFast: number;
  emaSlow: number;
  timestamp: number;
}

export class MomentumEngine {
  private prices: PricePoint[] = [];
  private config: MomentumConfig;
  private emaFast: number = 0;
  private emaSlow: number = 0;
  private emaInitialized: boolean = false;
  private nowFn: () => number;

  constructor(config: MomentumConfig, nowFn?: () => number) {
    this.config = config;
    this.nowFn = nowFn ?? (() => Date.now());
  }

  addPrice(point: PricePoint): void {
    this.prices.push(point);
    
    // Keep only recent prices
    const cutoff = this.nowFn() - (this.config.lookbackSeconds * 1000);
    this.prices = this.prices.filter(p => p.timestamp >= cutoff);
    
    // Only update EMA if the point is within the lookback window
    if (point.timestamp >= cutoff) {
      this.updateEma(point.price);
    }
  }

  analyze(): MomentumSignal {
    if (this.prices.length < 2) {
      return this.neutralSignal();
    }

    const oldest = this.prices[0];
    const newest = this.prices[this.prices.length - 1];
    
    // Guard against division by zero
    if (oldest.price === 0) return this.neutralSignal();
    
    const priceChangePct = ((newest.price - oldest.price) / oldest.price) * 100;
    
    // Volume analysis
    const avgVolume = this.prices.reduce((sum, p) => sum + p.volume, 0) / this.prices.length;
    const recentCount = Math.min(5, this.prices.length);
    const recentVolume = this.prices.slice(-recentCount).reduce((sum, p) => sum + p.volume, 0) / recentCount;
    const volumeConfirmed = recentVolume >= avgVolume * this.config.minVolumeMultiplier;
    
    // Direction determination
    let direction: MomentumDirection = 'NEUTRAL';
    if (Math.abs(priceChangePct) >= this.config.minPriceChangePct) {
      direction = priceChangePct > 0 ? 'BULLISH' : 'BEARISH';
    }
    
    // Strength calculation (0-1)
    const strength = Math.min(1, Math.abs(priceChangePct) / (this.config.minPriceChangePct * 3));
    
    return {
      direction,
      strength,
      priceChangePct,
      volumeConfirmed,
      emaFast: this.emaFast,
      emaSlow: this.emaSlow,
      timestamp: newest.timestamp
    };
  }

  getEmaFast(): number {
    return this.emaFast;
  }

  getEmaSlow(): number {
    return this.emaSlow;
  }

  private updateEma(price: number): void {
    if (!this.emaInitialized) {
      this.emaFast = price;
      this.emaSlow = price;
      this.emaInitialized = true;
      return;
    }

    const multiplierFast = 2 / (this.config.emaFastPeriod + 1);
    const multiplierSlow = 2 / (this.config.emaSlowPeriod + 1);
    
    this.emaFast = (price - this.emaFast) * multiplierFast + this.emaFast;
    this.emaSlow = (price - this.emaSlow) * multiplierSlow + this.emaSlow;
  }

  private neutralSignal(): MomentumSignal {
    return {
      direction: 'NEUTRAL',
      strength: 0,
      priceChangePct: 0,
      volumeConfirmed: false,
      emaFast: this.emaFast,
      emaSlow: this.emaSlow,
      timestamp: this.nowFn()
    };
  }
}
