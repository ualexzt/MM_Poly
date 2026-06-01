import { LatencyArbStrategy, LatencyArbStrategyConfig } from '../../src/strategy/latency-arb-strategy';
import { PriceUpdate } from '../../src/data/binance-ws-feed';
import { MomentumSignal } from '../../src/engines/momentum-engine';
import { MarketSnapshot } from '../../src/engines/divergence-engine';

describe('LatencyArbStrategy', () => {
  const defaultConfig: LatencyArbStrategyConfig = {
    symbols: ['BTCUSDT', 'ETHUSDT'],
    minConfidence: 0.6,
    maxPositionSizeUsd: 50,
    maxDailyTrades: 20,
    cooldownMs: 60000,
    mode: 'paper',
  };

  it('should initialize with correct config', () => {
    const strategy = new LatencyArbStrategy(defaultConfig);
    expect(strategy).toBeDefined();
    expect(strategy.getTradeCount()).toBe(0);
  });

  it('should process price update and generate signal', () => {
    const strategy = new LatencyArbStrategy(defaultConfig);

    // Simulate multiple price updates to build momentum
    const now = Date.now();
    for (let i = 0; i < 10; i++) {
      strategy.onPriceUpdate({
        symbol: 'BTCUSDT',
        price: 50000 + i * 100,
        timestamp: now - (10 - i) * 5000,
        volume: 100 + i * 10,
        high: 50000 + i * 100 + 50,
        low: 50000 + i * 100 - 50,
      });
    }

    // Strategy should have momentum data
    const momentum = strategy.getMomentum('BTCUSDT');
    expect(momentum).toBeDefined();
    expect(momentum?.direction).toBe('BULLISH');
  });

  it('should reject trade when confidence is below threshold', () => {
    const strategy = new LatencyArbStrategy({
      ...defaultConfig,
      minConfidence: 0.9, // Very high threshold
    });

    // Build strong price momentum but with flat volume (not volume-confirmed)
    // This gives high strength + divergence but low confidence due to no volume confirmation
    const now = Date.now();
    for (let i = 0; i < 20; i++) {
      strategy.onPriceUpdate({
        symbol: 'BTCUSDT',
        price: 50000 + i * 200, // Strong uptrend
        timestamp: now - (20 - i) * 3000,
        volume: 100, // Flat volume — won't pass volume confirmation
        high: 50000 + i * 200 + 100,
        low: 50000 + i * 200 - 100,
      });
    }

    const market: MarketSnapshot = {
      yesPrice: 0.45,
      noPrice: 0.55,
      midpoint: 0.45,
      spread: 0.10,
      timestamp: now,
    };

    const signal = strategy.analyzeMarket('BTCUSDT', market);
    expect(signal).toBeDefined();
    expect(signal?.action).toBe('NO_ACTION');
    expect(signal?.rejectionReason).toBe('confidence_too_low');
  });

  it('should respect daily trade limit', () => {
    const strategy = new LatencyArbStrategy({
      ...defaultConfig,
      maxDailyTrades: 2,
      mode: 'paper',
    });

    // Simulate 2 trades
    strategy.recordTrade({ action: 'BUY_YES', price: 0.5, size: 100, timestamp: Date.now() });
    strategy.recordTrade({ action: 'BUY_NO', price: 0.45, size: 100, timestamp: Date.now() });

    // Third trade should be blocked
    const canTrade = strategy.canTrade();
    expect(canTrade).toBe(false);
  });

  it('should enforce cooldown period', () => {
    const strategy = new LatencyArbStrategy({
      ...defaultConfig,
      cooldownMs: 60000, // 1 minute cooldown
    });

    // Record a trade
    strategy.recordTrade({ action: 'BUY_YES', price: 0.5, size: 100, timestamp: Date.now() });

    // Immediate second trade should be blocked
    expect(strategy.canTrade()).toBe(false);
  });
});
