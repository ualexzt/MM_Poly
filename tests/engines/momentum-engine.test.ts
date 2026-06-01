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
});
