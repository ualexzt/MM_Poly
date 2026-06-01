import { BinanceWsFeed, PriceUpdate } from '../data/binance-ws-feed';
import { MomentumEngine, MomentumSignal, MomentumConfig } from '../engines/momentum-engine';
import { analyzeDivergence, DivergenceSignal, MarketSnapshot } from '../engines/divergence-engine';
import { LatencyArbConfig, defaultLatencyArbConfig } from './latency-arb-config';

export interface LatencyArbStrategyConfig extends Partial<LatencyArbConfig> {
  symbols: string[];
  minConfidence: number;
  maxPositionSizeUsd: number;
  maxDailyTrades: number;
  cooldownMs: number;
  mode: 'paper' | 'shadow' | 'small_live';
}

export interface TradeRecord {
  action: string;
  price: number;
  size: number;
  timestamp: number;
}

export class LatencyArbStrategy {
  private config: LatencyArbConfig;
  private momentumEngines: Map<string, MomentumEngine> = new Map();
  private feed: BinanceWsFeed | null = null;
  private trades: TradeRecord[] = [];
  private lastTradeTime: number = 0;

  constructor(strategyConfig: LatencyArbStrategyConfig) {
    this.config = { ...defaultLatencyArbConfig, ...strategyConfig };

    const momentumConfig: MomentumConfig = {
      lookbackSeconds: this.config.lookbackSeconds,
      minPriceChangePct: this.config.minPriceChangePct,
      minVolumeMultiplier: this.config.minVolumeMultiplier,
      emaFastPeriod: this.config.emaFastPeriod,
      emaSlowPeriod: this.config.emaSlowPeriod,
    };

    for (const symbol of this.config.symbols) {
      this.momentumEngines.set(symbol.toLowerCase(), new MomentumEngine(momentumConfig));
    }
  }

  start(): void {
    this.feed = new BinanceWsFeed({
      symbols: this.config.symbols,
      wsBaseUrl: this.config.binanceWsUrl,
      onPriceUpdate: this.onPriceUpdate.bind(this),
      onError: (err) => console.error('[LatencyArb] Feed error:', err),
    });

    this.feed.connect();
    console.log('[LatencyArb] Strategy started');
  }

  stop(): void {
    if (this.feed) {
      this.feed.disconnect();
      this.feed = null;
    }
    console.log('[LatencyArb] Strategy stopped');
  }

  onPriceUpdate(update: PriceUpdate): void {
    const engine = this.momentumEngines.get(update.symbol.toLowerCase());
    if (!engine) return;

    engine.addPrice({
      price: update.price,
      timestamp: update.timestamp,
      volume: update.volume,
    });
  }

  getMomentum(symbol: string): MomentumSignal | null {
    const engine = this.momentumEngines.get(symbol.toLowerCase());
    if (!engine) return null;
    return engine.analyze();
  }

  analyzeMarket(symbol: string, market: MarketSnapshot): DivergenceSignal | null {
    const momentum = this.getMomentum(symbol);
    if (!momentum) return null;

    const signal = analyzeDivergence(
      {
        minDivergencePct: this.config.minDivergencePct,
        minEvPct: this.config.minEvPct,
        maxEntryPrice: this.config.maxEntryPrice,
        minEntryPrice: this.config.minEntryPrice,
      },
      momentum,
      market,
    );

    // Apply confidence threshold
    if (signal.action !== 'NO_ACTION' && signal.confidence < this.config.minConfidence) {
      return {
        ...signal,
        action: 'NO_ACTION',
        rejectionReason: 'confidence_too_low',
      };
    }

    return signal;
  }

  canTrade(): boolean {
    // Check daily limit
    const today = new Date().toDateString();
    const todayTrades = this.trades.filter(
      (t) => new Date(t.timestamp).toDateString() === today,
    );
    if (todayTrades.length >= this.config.maxDailyTrades) {
      return false;
    }

    // Check cooldown
    const timeSinceLastTrade = Date.now() - this.lastTradeTime;
    if (timeSinceLastTrade < this.config.cooldownMs) {
      return false;
    }

    return true;
  }

  recordTrade(trade: TradeRecord): void {
    this.trades.push(trade);
    this.lastTradeTime = trade.timestamp;
  }

  getTradeCount(): number {
    return this.trades.length;
  }

  getConfig(): LatencyArbConfig {
    return { ...this.config };
  }

  getStats(): { totalTrades: number; todayTrades: number; lastTradeTime: number } {
    const today = new Date().toDateString();
    const todayTrades = this.trades.filter(
      (t) => new Date(t.timestamp).toDateString() === today,
    );

    return {
      totalTrades: this.trades.length,
      todayTrades: todayTrades.length,
      lastTradeTime: this.lastTradeTime,
    };
  }
}
