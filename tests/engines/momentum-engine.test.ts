import { 
  MomentumEngine, 
  MomentumConfig, 
  PricePoint, 
  MomentumSignal 
} from '../../src/engines/momentum-engine';

describe('MomentumEngine', () => {
  const defaultConfig: MomentumConfig = {
    lookbackSeconds: 60,
    minPriceChangePct: 0.5,
    minVolumeMultiplier: 1.5,
    emaFastPeriod: 5,
    emaSlowPeriod: 20
  };

  it('should detect positive momentum', () => {
    const now = 1_000_000_000_000;
    const engine = new MomentumEngine(defaultConfig, () => now);
    
    engine.addPrice({ price: 50000, timestamp: now - 60000, volume: 100 });
    engine.addPrice({ price: 50100, timestamp: now - 40000, volume: 120 });
    engine.addPrice({ price: 50200, timestamp: now - 20000, volume: 150 });
    engine.addPrice({ price: 50300, timestamp: now, volume: 180 });
    
    const signal = engine.analyze();
    expect(signal.direction).toBe('BULLISH');
    expect(signal.strength).toBeGreaterThan(0);
    expect(signal.priceChangePct).toBeGreaterThan(0.5);
  });

  it('should detect negative momentum', () => {
    const now = 1_000_000_000_000;
    const engine = new MomentumEngine(defaultConfig, () => now);
    
    engine.addPrice({ price: 50000, timestamp: now - 60000, volume: 100 });
    engine.addPrice({ price: 49900, timestamp: now - 40000, volume: 120 });
    engine.addPrice({ price: 49800, timestamp: now - 20000, volume: 150 });
    engine.addPrice({ price: 49700, timestamp: now, volume: 180 });
    
    const signal = engine.analyze();
    expect(signal.direction).toBe('BEARISH');
    expect(signal.strength).toBeGreaterThan(0);
  });

  it('should return NEUTRAL for small price changes', () => {
    const now = 1_000_000_000_000;
    const engine = new MomentumEngine(defaultConfig, () => now);
    
    engine.addPrice({ price: 50000, timestamp: now - 60000, volume: 100 });
    engine.addPrice({ price: 50010, timestamp: now - 40000, volume: 100 });
    engine.addPrice({ price: 50020, timestamp: now - 20000, volume: 100 });
    engine.addPrice({ price: 50030, timestamp: now, volume: 100 });
    
    const signal = engine.analyze();
    expect(signal.direction).toBe('NEUTRAL');
  });

  it('should require minimum volume', () => {
    const now = 1_000_000_000_000;
    const engine = new MomentumEngine(defaultConfig, () => now);
    
    engine.addPrice({ price: 50000, timestamp: now - 60000, volume: 100 });
    engine.addPrice({ price: 50300, timestamp: now, volume: 50 }); // Low volume
    
    const signal = engine.analyze();
    expect(signal.volumeConfirmed).toBe(false);
  });

  it('should calculate EMA correctly', () => {
    const now = 1_000_000_000_000;
    const engine = new MomentumEngine(defaultConfig, () => now);
    
    // Add enough points for EMA calculation
    for (let i = 0; i < 25; i++) {
      engine.addPrice({ 
        price: 50000 + i * 10, 
        timestamp: now - (25 - i) * 1000, 
        volume: 100 
      });
    }
    
    const emaFast = engine.getEmaFast();
    const emaSlow = engine.getEmaSlow();
    
    expect(emaFast).toBeGreaterThan(0);
    expect(emaSlow).toBeGreaterThan(0);
    expect(emaFast).toBeGreaterThan(emaSlow); // Uptrend
  });

  it('should exclude prices outside lookback window and not contaminate EMA', () => {
    const now = 1_000_000_000_000;
    const engine = new MomentumEngine(defaultConfig, () => now);
    
    // Add a stale price (120s ago, outside 60s lookback)
    engine.addPrice({ price: 99999, timestamp: now - 120000, volume: 100 });
    
    // Add prices within window
    engine.addPrice({ price: 50000, timestamp: now - 30000, volume: 100 });
    engine.addPrice({ price: 50100, timestamp: now, volume: 100 });
    
    const signal = engine.analyze();
    // The stale price should not affect the signal
    expect(signal.priceChangePct).toBeCloseTo(0.2, 1); // (50100-50000)/50000
    
    // EMA should not include the stale price 99999
    // With only 2 in-window prices, EMA should be close to recent prices
    expect(engine.getEmaFast()).toBeLessThan(60000);
    expect(engine.getEmaSlow()).toBeLessThan(60000);
  });

  it('should return neutral signal with 0 prices', () => {
    const now = 1_000_000_000_000;
    const engine = new MomentumEngine(defaultConfig, () => now);
    const signal = engine.analyze();
    expect(signal.direction).toBe('NEUTRAL');
    expect(signal.strength).toBe(0);
    expect(signal.priceChangePct).toBe(0);
    expect(signal.volumeConfirmed).toBe(false);
  });

  it('should return neutral signal with 1 price', () => {
    const now = 1_000_000_000_000;
    const engine = new MomentumEngine(defaultConfig, () => now);
    engine.addPrice({ price: 50000, timestamp: now, volume: 100 });
    const signal = engine.analyze();
    expect(signal.direction).toBe('NEUTRAL');
    expect(signal.strength).toBe(0);
  });

  it('should return neutral signal when oldest price is zero', () => {
    const now = 1_000_000_000_000;
    const engine = new MomentumEngine(defaultConfig, () => now);
    engine.addPrice({ price: 0, timestamp: now - 30000, volume: 100 });
    engine.addPrice({ price: 100, timestamp: now, volume: 100 });
    const signal = engine.analyze();
    expect(signal.direction).toBe('NEUTRAL');
    expect(signal.strength).toBe(0);
    expect(signal.priceChangePct).toBe(0);
  });

  it('should cap strength at 1.0', () => {
    const now = 1_000_000_000_000;
    const engine = new MomentumEngine({
      ...defaultConfig,
      minPriceChangePct: 0.5
    }, () => now);
    
    engine.addPrice({ price: 100, timestamp: now - 60000, volume: 100 });
    engine.addPrice({ price: 200, timestamp: now, volume: 100 }); // 100% change
    
    const signal = engine.analyze();
    expect(signal.strength).toBe(1.0); // Capped at 1
  });

  it('should detect NEUTRAL at exact threshold boundary', () => {
    const now = 1_000_000_000_000;
    const engine = new MomentumEngine({
      ...defaultConfig,
      minPriceChangePct: 1.0
    }, () => now);
    
    engine.addPrice({ price: 100, timestamp: now - 60000, volume: 100 });
    engine.addPrice({ price: 100.99, timestamp: now, volume: 100 }); // 0.99% < 1.0%
    
    const signal = engine.analyze();
    expect(signal.direction).toBe('NEUTRAL');
  });

  it('should confirm volume when recent volume is high', () => {
    const now = 1_000_000_000_000;
    const engine = new MomentumEngine(defaultConfig, () => now);
    
    // Low volume initially
    for (let i = 0; i < 10; i++) {
      engine.addPrice({ price: 50000, timestamp: now - (10 - i) * 5000, volume: 50 });
    }
    // High volume recently
    engine.addPrice({ price: 50300, timestamp: now - 2000, volume: 500 });
    engine.addPrice({ price: 50400, timestamp: now, volume: 500 });
    
    const signal = engine.analyze();
    expect(signal.volumeConfirmed).toBe(true);
  });

  it('should detect bearish EMA crossover', () => {
    const now = 1_000_000_000_000;
    const engine = new MomentumEngine(defaultConfig, () => now);
    
    // Start high, go low
    for (let i = 0; i < 25; i++) {
      engine.addPrice({ 
        price: 50000 - i * 10, 
        timestamp: now - (25 - i) * 1000, 
        volume: 100 
      });
    }
    
    expect(engine.getEmaFast()).toBeLessThan(engine.getEmaSlow());
  });

  it('should set signal timestamp to newest price timestamp', () => {
    const now = 1_000_000_000_000;
    const engine = new MomentumEngine(defaultConfig, () => now);
    const ts1 = now - 50000;
    const ts2 = now - 30000;
    const ts3 = now - 10000;
    
    engine.addPrice({ price: 50000, timestamp: ts1, volume: 100 });
    engine.addPrice({ price: 50100, timestamp: ts2, volume: 100 });
    engine.addPrice({ price: 50200, timestamp: ts3, volume: 100 });
    
    const signal = engine.analyze();
    expect(signal.timestamp).toBe(ts3);
  });
});
