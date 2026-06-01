import { MomentumSignal } from './momentum-engine';

export interface DivergenceConfig {
  minDivergencePct: number;
  minEvPct: number;
  maxEntryPrice: number;
  minEntryPrice: number;
}

export interface MarketSnapshot {
  yesPrice: number;
  noPrice: number;
  midpoint: number;
  spread: number;
  timestamp: number;
}

export type TradeAction = 'BUY_YES' | 'BUY_NO' | 'NO_ACTION';

export interface DivergenceSignal {
  action: TradeAction;
  divergencePct: number;
  expectedValue: number;
  entryPrice: number;
  confidence: number;
  rejectionReason?: string;
  timestamp: number;
}

export class DivergenceEngine {
  private config: DivergenceConfig;

  constructor(config: DivergenceConfig) {
    this.config = config;
  }

  analyze(momentum: MomentumSignal, market: MarketSnapshot): DivergenceSignal {
    // Skip neutral momentum
    if (momentum.direction === 'NEUTRAL') {
      return this.noAction(0, 0, 'neutral_momentum');
    }

    // Determine which side to buy based on momentum
    const isBullish = momentum.direction === 'BULLISH';
    const entryPrice = isBullish ? market.yesPrice : market.noPrice;
    
    // Check entry price range
    if (entryPrice > this.config.maxEntryPrice) {
      return this.noAction(0, entryPrice, 'entry_price_too_high');
    }
    if (entryPrice < this.config.minEntryPrice) {
      return this.noAction(0, entryPrice, 'entry_price_too_low');
    }

    // Calculate implied probability from momentum
    const impliedProbability = this.estimateProbability(momentum);
    
    // Calculate divergence
    const divergencePct = ((impliedProbability - entryPrice) / entryPrice) * 100;
    
    // Check minimum divergence
    if (divergencePct < this.config.minDivergencePct) {
      return this.noAction(divergencePct, entryPrice, 'divergence_too_small');
    }

    // Calculate Expected Value
    const payout = 1.0;
    const expectedValue = (impliedProbability * payout) - entryPrice;
    const evPct = (expectedValue / entryPrice) * 100;
    
    // Check minimum EV
    if (evPct < this.config.minEvPct) {
      return this.noAction(divergencePct, entryPrice, 'ev_too_low');
    }

    // Calculate confidence
    const confidence = this.calculateConfidence(momentum, divergencePct);

    return {
      action: isBullish ? 'BUY_YES' : 'BUY_NO',
      divergencePct,
      expectedValue: evPct,
      entryPrice,
      confidence,
      timestamp: Date.now()
    };
  }

  private estimateProbability(momentum: MomentumSignal): number {
    const baseProbability = 0.50;
    const momentumAdjustment = momentum.strength * 0.20;
    const volumeBonus = momentum.volumeConfirmed ? 0.05 : 0;
    const emaTrend = momentum.emaFast > momentum.emaSlow ? 0.05 : -0.05;
    
    return Math.min(0.85, 
      baseProbability + momentumAdjustment + volumeBonus + emaTrend
    );
  }

  private calculateConfidence(momentum: MomentumSignal, divergencePct: number): number {
    const strengthWeight = 0.4;
    const volumeWeight = 0.3;
    const divergenceWeight = 0.3;
    
    const strengthScore = momentum.strength;
    const volumeScore = momentum.volumeConfirmed ? 1 : 0;
    const divergenceScore = Math.min(1, divergencePct / 10);
    
    return (
      strengthScore * strengthWeight +
      volumeScore * volumeWeight +
      divergenceScore * divergenceWeight
    );
  }

  private noAction(divergencePct: number, entryPrice: number, reason: string): DivergenceSignal {
    return {
      action: 'NO_ACTION',
      divergencePct,
      expectedValue: 0,
      entryPrice,
      confidence: 0,
      rejectionReason: reason,
      timestamp: Date.now()
    };
  }
}
