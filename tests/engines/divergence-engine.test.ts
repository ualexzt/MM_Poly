import { 
  DivergenceEngine, 
  DivergenceConfig, 
  MarketSnapshot, 
  DivergenceSignal 
} from '../../src/engines/divergence-engine';
import { MomentumSignal } from '../../src/engines/momentum-engine';

describe('DivergenceEngine', () => {
  const defaultConfig: DivergenceConfig = {
    minDivergencePct: 3.0,
    minEvPct: 2.0,
    maxEntryPrice: 0.70,
    minEntryPrice: 0.20
  };

  it('should detect BUY YES opportunity when momentum is bullish and YES is cheap', () => {
    const engine = new DivergenceEngine(defaultConfig);
    
    const momentum: MomentumSignal = {
      direction: 'BULLISH',
      strength: 0.8,
      priceChangePct: 1.2,
      volumeConfirmed: true,
      emaFast: 50300,
      emaSlow: 50100,
      timestamp: Date.now()
    };
    
    const market: MarketSnapshot = {
      yesPrice: 0.45,
      noPrice: 0.55,
      midpoint: 0.45,
      spread: 0.10,
      timestamp: Date.now()
    };
    
    const signal = engine.analyze(momentum, market);
    expect(signal.action).toBe('BUY_YES');
    expect(signal.expectedValue).toBeGreaterThan(0);
    expect(signal.divergencePct).toBeGreaterThan(3);
  });

  it('should detect BUY NO opportunity when momentum is bearish and NO is cheap', () => {
    const engine = new DivergenceEngine(defaultConfig);
    
    const momentum: MomentumSignal = {
      direction: 'BEARISH',
      strength: 0.7,
      priceChangePct: -0.8,
      volumeConfirmed: true,
      emaFast: 49800,
      emaSlow: 50000,
      timestamp: Date.now()
    };
    
    const market: MarketSnapshot = {
      yesPrice: 0.60,
      noPrice: 0.40,
      midpoint: 0.60,
      spread: 0.20,
      timestamp: Date.now()
    };
    
    const signal = engine.analyze(momentum, market);
    expect(signal.action).toBe('BUY_NO');
    expect(signal.expectedValue).toBeGreaterThan(0);
  });

  it('should return NO_ACTION for neutral momentum', () => {
    const engine = new DivergenceEngine(defaultConfig);
    
    const momentum: MomentumSignal = {
      direction: 'NEUTRAL',
      strength: 0.1,
      priceChangePct: 0.1,
      volumeConfirmed: false,
      emaFast: 50000,
      emaSlow: 50000,
      timestamp: Date.now()
    };
    
    const market: MarketSnapshot = {
      yesPrice: 0.50,
      noPrice: 0.50,
      midpoint: 0.50,
      spread: 0.00,
      timestamp: Date.now()
    };
    
    const signal = engine.analyze(momentum, market);
    expect(signal.action).toBe('NO_ACTION');
  });

  it('should reject entries outside price range', () => {
    const engine = new DivergenceEngine(defaultConfig);
    
    const momentum: MomentumSignal = {
      direction: 'BULLISH',
      strength: 0.9,
      priceChangePct: 2.0,
      volumeConfirmed: true,
      emaFast: 50500,
      emaSlow: 50000,
      timestamp: Date.now()
    };
    
    const market: MarketSnapshot = {
      yesPrice: 0.85, // Too expensive
      noPrice: 0.15,
      midpoint: 0.85,
      spread: 0.70,
      timestamp: Date.now()
    };
    
    const signal = engine.analyze(momentum, market);
    expect(signal.action).toBe('NO_ACTION');
    expect(signal.rejectionReason).toBe('entry_price_too_high');
  });

  it('should calculate expected value correctly', () => {
    const engine = new DivergenceEngine(defaultConfig);
    
    const momentum: MomentumSignal = {
      direction: 'BULLISH',
      strength: 0.8,
      priceChangePct: 1.0,
      volumeConfirmed: true,
      emaFast: 50200,
      emaSlow: 50000,
      timestamp: Date.now()
    };
    
    const market: MarketSnapshot = {
      yesPrice: 0.45,
      noPrice: 0.55,
      midpoint: 0.45,
      spread: 0.10,
      timestamp: Date.now()
    };
    
    const signal = engine.analyze(momentum, market);
    
    // EV = (probability_of_win * payout) - cost
    // If momentum suggests 60% probability, entry at 0.45
    // EV = (0.60 * 1.0) - 0.45 = 0.15 = 15%
    expect(signal.expectedValue).toBeGreaterThan(0);
  });

  it('should reject entry price too low', () => {
    const engine = new DivergenceEngine(defaultConfig);
    
    const momentum: MomentumSignal = {
      direction: 'BULLISH',
      strength: 0.9,
      priceChangePct: 2.0,
      volumeConfirmed: true,
      emaFast: 50500,
      emaSlow: 50000,
      timestamp: Date.now()
    };
    
    const market: MarketSnapshot = {
      yesPrice: 0.10, // Too cheap
      noPrice: 0.90,
      midpoint: 0.10,
      spread: 0.80,
      timestamp: Date.now()
    };
    
    const signal = engine.analyze(momentum, market);
    expect(signal.action).toBe('NO_ACTION');
    expect(signal.rejectionReason).toBe('entry_price_too_low');
  });

  it('should reject when divergence is too small', () => {
    const engine = new DivergenceEngine({
      ...defaultConfig,
      minDivergencePct: 50.0 // Unreachable threshold
    });
    
    const momentum: MomentumSignal = {
      direction: 'BULLISH',
      strength: 0.5,
      priceChangePct: 0.5,
      volumeConfirmed: false,
      emaFast: 50050,
      emaSlow: 50000,
      timestamp: Date.now()
    };
    
    const market: MarketSnapshot = {
      yesPrice: 0.50,
      noPrice: 0.50,
      midpoint: 0.50,
      spread: 0.00,
      timestamp: Date.now()
    };
    
    const signal = engine.analyze(momentum, market);
    expect(signal.action).toBe('NO_ACTION');
    expect(signal.rejectionReason).toBe('divergence_too_small');
  });

  it('should include confidence score in signal', () => {
    const engine = new DivergenceEngine(defaultConfig);
    
    const momentum: MomentumSignal = {
      direction: 'BULLISH',
      strength: 0.8,
      priceChangePct: 1.2,
      volumeConfirmed: true,
      emaFast: 50300,
      emaSlow: 50100,
      timestamp: Date.now()
    };
    
    const market: MarketSnapshot = {
      yesPrice: 0.45,
      noPrice: 0.55,
      midpoint: 0.45,
      spread: 0.10,
      timestamp: Date.now()
    };
    
    const signal = engine.analyze(momentum, market);
    expect(signal.confidence).toBeGreaterThan(0);
    expect(signal.confidence).toBeLessThanOrEqual(1);
  });

  it('should use noPrice for BEARISH momentum entry', () => {
    const engine = new DivergenceEngine(defaultConfig);
    
    const momentum: MomentumSignal = {
      direction: 'BEARISH',
      strength: 0.8,
      priceChangePct: -1.2,
      volumeConfirmed: true,
      emaFast: 49700,
      emaSlow: 50000,
      timestamp: Date.now()
    };
    
    const market: MarketSnapshot = {
      yesPrice: 0.65,
      noPrice: 0.35,
      midpoint: 0.65,
      spread: 0.30,
      timestamp: Date.now()
    };
    
    const signal = engine.analyze(momentum, market);
    expect(signal.action).toBe('BUY_NO');
    expect(signal.entryPrice).toBe(0.35);
  });
});
