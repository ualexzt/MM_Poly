import { MicroGabagoolPaperEngine } from '../../src/simulation/micro-gabagool-paper-engine';

const defaultConfig = {
  gasPerRoundtripEstimateUsd: 0.004,
  makerRebateRate: 0.001,
  fillProbability: 1.0, // Always fill for deterministic tests
  partialFillProbability: 0.0, // Never partial
  lateFillProbability: 0.0, // Never late
};

describe('MicroGabagoolPaperEngine', () => {
  it('should simulate fill when price is below ask', () => {
    const engine = new MicroGabagoolPaperEngine(defaultConfig);
    const fill = engine.simulateFill('order-1', 0.45, 1.0, { bestBid: 0.44, bestAsk: 0.48 });

    expect(fill).not.toBeNull();
    expect(fill!.filledSizeUsd).toBe(1.0);
    expect(fill!.isPartial).toBe(false);
    expect(fill!.isLateFill).toBe(false);
  });

  it('should reject fill when price crosses ask', () => {
    const engine = new MicroGabagoolPaperEngine(defaultConfig);
    const fill = engine.simulateFill('order-1', 0.49, 1.0, { bestBid: 0.44, bestAsk: 0.48 });

    expect(fill).toBeNull();
  });

  it('should reject fill when price equals ask', () => {
    const engine = new MicroGabagoolPaperEngine(defaultConfig);
    const fill = engine.simulateFill('order-1', 0.48, 1.0, { bestBid: 0.44, bestAsk: 0.48 });

    expect(fill).toBeNull();
  });

  it('should simulate gas cost', () => {
    const engine = new MicroGabagoolPaperEngine(defaultConfig);
    expect(engine.simulateGasCost()).toBe(0.004);
  });

  it('should simulate maker rebate', () => {
    const engine = new MicroGabagoolPaperEngine(defaultConfig);
    expect(engine.simulateMakerRebate(1.0)).toBeCloseTo(0.001, 4);
    expect(engine.simulateMakerRebate(1.5)).toBeCloseTo(0.0015, 4);
  });

  it('should simulate partial fill', () => {
    const config = { ...defaultConfig, partialFillProbability: 1.0 };
    const engine = new MicroGabagoolPaperEngine(config);

    const fill = engine.simulateFill('order-1', 0.45, 1.0, { bestBid: 0.44, bestAsk: 0.48 });

    expect(fill).not.toBeNull();
    expect(fill!.isPartial).toBe(true);
    expect(fill!.filledSizeUsd).toBeGreaterThan(0);
    expect(fill!.filledSizeUsd).toBeLessThan(1.0);
  });

  it('should not fill when random fails', () => {
    const config = { ...defaultConfig, fillProbability: 0.0 };
    const engine = new MicroGabagoolPaperEngine(config);

    const fill = engine.simulateFill('order-1', 0.45, 1.0, { bestBid: 0.44, bestAsk: 0.48 });

    expect(fill).toBeNull();
  });

  it('should detect late fill after cancel', () => {
    const config = { ...defaultConfig, lateFillProbability: 1.0 };
    const engine = new MicroGabagoolPaperEngine(config);

    engine.recordCancel('order-1', { price: 0.45, sizeUsd: 1.0 });
    const lateFill = engine.simulateLateFill('order-1', 0.45, 1.0);

    expect(lateFill).not.toBeNull();
    expect(lateFill!.isLateFill).toBe(true);
    expect(lateFill!.filledSizeUsd).toBe(1.0);
  });

  it('should not late fill if no pending cancel', () => {
    const config = { ...defaultConfig, lateFillProbability: 1.0 };
    const engine = new MicroGabagoolPaperEngine(config);

    const lateFill = engine.simulateLateFill('order-1', 0.45, 1.0);
    expect(lateFill).toBeNull();
  });

  it('should not late fill when random fails', () => {
    const config = { ...defaultConfig, lateFillProbability: 0.0 };
    const engine = new MicroGabagoolPaperEngine(config);

    engine.recordCancel('order-1', { price: 0.45, sizeUsd: 1.0 });
    const lateFill = engine.simulateLateFill('order-1', 0.45, 1.0);

    expect(lateFill).toBeNull();
  });

  it('should clear pending cancel after late fill attempt', () => {
    const config = { ...defaultConfig, lateFillProbability: 0.0 };
    const engine = new MicroGabagoolPaperEngine(config);

    engine.recordCancel('order-1', { price: 0.45, sizeUsd: 1.0 });
    engine.simulateLateFill('order-1', 0.45, 1.0);

    // Second attempt should return null (no pending cancel)
    const secondAttempt = engine.simulateLateFill('order-1', 0.45, 1.0);
    expect(secondAttempt).toBeNull();
  });
});
