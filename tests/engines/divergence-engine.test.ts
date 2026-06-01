import {
  analyzeDivergence,
  DivergenceConfig,
  MarketSnapshot,
  DivergenceSignal
} from '../../src/engines/divergence-engine';
import { MomentumSignal } from '../../src/engines/momentum-engine';

const FIXED_TS = 1700000000000;
const nowFn = () => FIXED_TS;

describe('analyzeDivergence (pure function)', () => {
  const defaultConfig: DivergenceConfig = {
    minDivergencePct: 3.0,
    minEvPct: 2.0,
    maxEntryPrice: 0.70,
    minEntryPrice: 0.20
  };

  it('should detect BUY YES opportunity when momentum is bullish and YES is cheap', () => {
    const momentum: MomentumSignal = {
      direction: 'BULLISH',
      strength: 0.8,
      priceChangePct: 1.2,
      volumeConfirmed: true,
      emaFast: 50300,
      emaSlow: 50100,
      timestamp: FIXED_TS
    };

    const market: MarketSnapshot = {
      yesPrice: 0.45,
      noPrice: 0.55,
      midpoint: 0.45,
      spread: 0.10,
      timestamp: FIXED_TS
    };

    const signal = analyzeDivergence(defaultConfig, momentum, market, nowFn);
    expect(signal.action).toBe('BUY_YES');
    expect(signal.expectedValue).toBeGreaterThan(0);
    expect(signal.expectedValuePct).toBeGreaterThan(0);
    expect(signal.divergencePct).toBeGreaterThan(3);
  });

  it('should detect BUY NO opportunity when momentum is bearish and NO is cheap', () => {
    const momentum: MomentumSignal = {
      direction: 'BEARISH',
      strength: 0.7,
      priceChangePct: -0.8,
      volumeConfirmed: true,
      emaFast: 49800,
      emaSlow: 50000,
      timestamp: FIXED_TS
    };

    const market: MarketSnapshot = {
      yesPrice: 0.60,
      noPrice: 0.40,
      midpoint: 0.60,
      spread: 0.20,
      timestamp: FIXED_TS
    };

    const signal = analyzeDivergence(defaultConfig, momentum, market, nowFn);
    expect(signal.action).toBe('BUY_NO');
    expect(signal.expectedValue).toBeGreaterThan(0);
    expect(signal.expectedValuePct).toBeGreaterThan(0);
  });

  it('should return NO_ACTION for neutral momentum', () => {
    const momentum: MomentumSignal = {
      direction: 'NEUTRAL',
      strength: 0.1,
      priceChangePct: 0.1,
      volumeConfirmed: false,
      emaFast: 50000,
      emaSlow: 50000,
      timestamp: FIXED_TS
    };

    const market: MarketSnapshot = {
      yesPrice: 0.50,
      noPrice: 0.50,
      midpoint: 0.50,
      spread: 0.00,
      timestamp: FIXED_TS
    };

    const signal = analyzeDivergence(defaultConfig, momentum, market, nowFn);
    expect(signal.action).toBe('NO_ACTION');
  });

  it('should reject entries outside price range', () => {
    const momentum: MomentumSignal = {
      direction: 'BULLISH',
      strength: 0.9,
      priceChangePct: 2.0,
      volumeConfirmed: true,
      emaFast: 50500,
      emaSlow: 50000,
      timestamp: FIXED_TS
    };

    const market: MarketSnapshot = {
      yesPrice: 0.85, // Too expensive
      noPrice: 0.15,
      midpoint: 0.85,
      spread: 0.70,
      timestamp: FIXED_TS
    };

    const signal = analyzeDivergence(defaultConfig, momentum, market, nowFn);
    expect(signal.action).toBe('NO_ACTION');
    expect(signal.rejectionReason).toBe('entry_price_too_high');
  });

  it('should calculate expected value correctly', () => {
    const momentum: MomentumSignal = {
      direction: 'BULLISH',
      strength: 0.8,
      priceChangePct: 1.0,
      volumeConfirmed: true,
      emaFast: 50200,
      emaSlow: 50000,
      timestamp: FIXED_TS
    };

    const market: MarketSnapshot = {
      yesPrice: 0.45,
      noPrice: 0.55,
      midpoint: 0.45,
      spread: 0.10,
      timestamp: FIXED_TS
    };

    const signal = analyzeDivergence(defaultConfig, momentum, market, nowFn);

    // expectedValue is raw (e.g. 0.15), expectedValuePct is percentage (e.g. 33.3)
    expect(signal.expectedValue).toBeGreaterThan(0);
    expect(signal.expectedValuePct).toBeGreaterThan(0);
    expect(signal.expectedValuePct).toBeCloseTo((signal.expectedValue / signal.entryPrice) * 100, 5);
  });

  it('should reject entry price too low', () => {
    const momentum: MomentumSignal = {
      direction: 'BULLISH',
      strength: 0.9,
      priceChangePct: 2.0,
      volumeConfirmed: true,
      emaFast: 50500,
      emaSlow: 50000,
      timestamp: FIXED_TS
    };

    const market: MarketSnapshot = {
      yesPrice: 0.10, // Too cheap
      noPrice: 0.90,
      midpoint: 0.10,
      spread: 0.80,
      timestamp: FIXED_TS
    };

    const signal = analyzeDivergence(defaultConfig, momentum, market, nowFn);
    expect(signal.action).toBe('NO_ACTION');
    expect(signal.rejectionReason).toBe('entry_price_too_low');
  });

  it('should reject when divergence is too small', () => {
    const config: DivergenceConfig = {
      ...defaultConfig,
      minDivergencePct: 50.0 // Unreachable threshold
    };

    const momentum: MomentumSignal = {
      direction: 'BULLISH',
      strength: 0.5,
      priceChangePct: 0.5,
      volumeConfirmed: false,
      emaFast: 50050,
      emaSlow: 50000,
      timestamp: FIXED_TS
    };

    const market: MarketSnapshot = {
      yesPrice: 0.50,
      noPrice: 0.50,
      midpoint: 0.50,
      spread: 0.00,
      timestamp: FIXED_TS
    };

    const signal = analyzeDivergence(config, momentum, market, nowFn);
    expect(signal.action).toBe('NO_ACTION');
    expect(signal.rejectionReason).toBe('divergence_too_small');
  });

  it('should include confidence score in signal', () => {
    const momentum: MomentumSignal = {
      direction: 'BULLISH',
      strength: 0.8,
      priceChangePct: 1.2,
      volumeConfirmed: true,
      emaFast: 50300,
      emaSlow: 50100,
      timestamp: FIXED_TS
    };

    const market: MarketSnapshot = {
      yesPrice: 0.45,
      noPrice: 0.55,
      midpoint: 0.45,
      spread: 0.10,
      timestamp: FIXED_TS
    };

    const signal = analyzeDivergence(defaultConfig, momentum, market, nowFn);
    expect(signal.confidence).toBeGreaterThan(0);
    expect(signal.confidence).toBeLessThanOrEqual(1);
  });

  it('should use noPrice for BEARISH momentum entry', () => {
    const momentum: MomentumSignal = {
      direction: 'BEARISH',
      strength: 0.8,
      priceChangePct: -1.2,
      volumeConfirmed: true,
      emaFast: 49700,
      emaSlow: 50000,
      timestamp: FIXED_TS
    };

    const market: MarketSnapshot = {
      yesPrice: 0.65,
      noPrice: 0.35,
      midpoint: 0.65,
      spread: 0.30,
      timestamp: FIXED_TS
    };

    const signal = analyzeDivergence(defaultConfig, momentum, market, nowFn);
    expect(signal.action).toBe('BUY_NO');
    expect(signal.entryPrice).toBe(0.35);
  });

  it('should reject when EV is too low', () => {
    // minDivergencePct=1.0 (low), minEvPct=50.0 (very high)
    // With low momentum, impliedProb ≈ 0.47, entryPrice = 0.45
    // divergencePct ≈ 4.4% (passes minDivergencePct=1.0)
    // expectedValuePct ≈ 4.4% (fails minEvPct=50.0)
    const config: DivergenceConfig = {
      minDivergencePct: 1.0,
      minEvPct: 50.0,
      maxEntryPrice: 0.70,
      minEntryPrice: 0.20
    };

    const momentum: MomentumSignal = {
      direction: 'BULLISH',
      strength: 0.1,
      priceChangePct: 0.2,
      volumeConfirmed: false,
      emaFast: 49900,
      emaSlow: 50000,
      timestamp: FIXED_TS
    };

    const market: MarketSnapshot = {
      yesPrice: 0.45,
      noPrice: 0.55,
      midpoint: 0.45,
      spread: 0.10,
      timestamp: FIXED_TS
    };

    const signal = analyzeDivergence(config, momentum, market, nowFn);
    expect(signal.action).toBe('NO_ACTION');
    expect(signal.rejectionReason).toBe('ev_too_low');
  });

  it('should treat bearish EMA alignment as positive for BUY_NO probability', () => {
    const bearishAligned: MomentumSignal = {
      direction: 'BEARISH',
      strength: 0.5,
      priceChangePct: -0.8,
      volumeConfirmed: false,
      emaFast: 49000,
      emaSlow: 50000,
      timestamp: FIXED_TS,
    };

    const bearishMisaligned: MomentumSignal = {
      ...bearishAligned,
      emaFast: 51000,
      emaSlow: 50000,
    };

    const market: MarketSnapshot = {
      yesPrice: 0.55,
      noPrice: 0.49,
      midpoint: 0.52,
      spread: 0.06,
      timestamp: FIXED_TS,
    };

    const aligned = analyzeDivergence(defaultConfig, bearishAligned, market, nowFn);
    const misaligned = analyzeDivergence(defaultConfig, bearishMisaligned, market, nowFn);

    expect(aligned.action).toBe('BUY_NO');
    expect(aligned.expectedValue).toBeGreaterThan(misaligned.expectedValue);
    expect(aligned.divergencePct).toBeGreaterThan(misaligned.divergencePct);
  });

  it('should produce deterministic output with nowFn', () => {
    const momentum: MomentumSignal = {
      direction: 'BULLISH',
      strength: 0.8,
      priceChangePct: 1.2,
      volumeConfirmed: true,
      emaFast: 50300,
      emaSlow: 50100,
      timestamp: FIXED_TS
    };

    const market: MarketSnapshot = {
      yesPrice: 0.45,
      noPrice: 0.55,
      midpoint: 0.45,
      spread: 0.10,
      timestamp: FIXED_TS
    };

    const s1 = analyzeDivergence(defaultConfig, momentum, market, nowFn);
    const s2 = analyzeDivergence(defaultConfig, momentum, market, nowFn);
    expect(s1).toEqual(s2);
    expect(s1.timestamp).toBe(FIXED_TS);
  });
});
