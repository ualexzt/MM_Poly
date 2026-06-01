import { LatencyArbShadowExecutor, ShadowExecutorConfig } from '../../src/simulation/latency-arb-shadow-executor';
import { DivergenceSignal } from '../../src/engines/divergence-engine';
import { MarketState } from '../../src/types/market';
import { LatencyArbExecutionSnapshot } from '../../src/strategy/latency-arb-orderbook';

const market: MarketState = {
  conditionId: 'cond-btc-15',
  slug: 'bitcoin-up-or-down-15m',
  question: 'Bitcoin Up or Down - 15m',
  yesTokenId: 'yes',
  noTokenId: 'no',
  active: true,
  closed: false,
  enableOrderBook: true,
  feesEnabled: true,
  volume24hUsd: 1000,
  liquidityUsd: 1000,
  oracleAmbiguityScore: 0.05,
};

const execution: LatencyArbExecutionSnapshot = {
  yesBestBid: 0.44,
  yesBestAsk: 0.46,
  noBestBid: 0.54,
  noBestAsk: 0.56,
  tickSize: 0.01,
  minOrderSize: 1,
};

const signal: DivergenceSignal = {
  action: 'BUY_YES',
  divergencePct: 20,
  expectedValue: 0.1,
  expectedValuePct: 22,
  entryPrice: 0.46,
  confidence: 0.8,
  timestamp: 1700000000000,
};

const config: ShadowExecutorConfig = {
  mode: 'shadow',
  asset: 'BTC',
  duration: '15m',
  startingBalanceUsd: 15.48,
  orderBalanceFraction: 0.1,
  maxOrderSizeUsd: 1.55,
  maxPositionUsd: 1.55,
  minConfidence: 0.6,
};

describe('LatencyArbShadowExecutor', () => {
  it('should create a post-only would-place order event for actionable signal', () => {
    const writes: Record<string, unknown>[] = [];
    const executor = new LatencyArbShadowExecutor(config, (event) => writes.push(event));

    const result = executor.evaluate({ market, signal, execution, nowMs: 1700000000100, currentExposureUsd: 0 });

    expect(result.ok).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      eventType: 'would_place_order',
      mode: 'shadow',
      asset: 'BTC',
      duration: '15m',
      conditionId: 'cond-btc-15',
      action: 'BUY_YES',
      orderType: 'post_only_limit',
      makerPrice: 0.44,
      takerPrice: 0.46,
    });
    expect(writes[0]).toMatchObject({ tokenId: 'yes', side: 'BUY', currentExposureUsd: 0 });
    expect(writes[0].projectedExposureUsd).toBeCloseTo(1.548, 3);
    expect(writes[0].minOrderSize).toBe(1);
    expect(writes[0].sizeUsd).toBeCloseTo(1.548, 3);
    expect(writes[0].shares).toBeCloseTo(1.548 / 0.44, 3);
  });

  it('should create BUY_NO event with NO token and prices', () => {
    const writes: Record<string, unknown>[] = [];
    const executor = new LatencyArbShadowExecutor(config, (event) => writes.push(event));

    const result = executor.evaluate({
      market,
      signal: { ...signal, action: 'BUY_NO', entryPrice: 0.56 },
      execution,
      nowMs: 1700000000100,
      currentExposureUsd: 0,
    });

    expect(result.ok).toBe(true);
    expect(writes[0]).toMatchObject({
      eventType: 'would_place_order',
      action: 'BUY_NO',
      tokenId: 'no',
      side: 'BUY',
      makerPrice: 0.54,
      takerPrice: 0.56,
    });
  });

  it('should reject binary execution prices above one', () => {
    const writes: Record<string, unknown>[] = [];
    const executor = new LatencyArbShadowExecutor(config, (event) => writes.push(event));

    const result = executor.evaluate({
      market,
      signal,
      execution: { ...execution, yesBestBid: 1.01 },
      nowMs: 1700000000100,
      currentExposureUsd: 0,
    });

    expect(result).toEqual({ ok: false, reason: 'invalid_execution_price' });
    expect(writes[0]).toMatchObject({ eventType: 'skip', reason: 'invalid_execution_price' });
  });

  it('should reject invalid config and exposure domains', () => {
    const writes: Record<string, unknown>[] = [];
    const invalidConfig = new LatencyArbShadowExecutor({ ...config, maxPositionUsd: Number.NaN }, (event) => writes.push(event));

    expect(invalidConfig.evaluate({ market, signal, execution, nowMs: 1700000000100, currentExposureUsd: 0 }))
      .toEqual({ ok: false, reason: 'invalid_risk_config' });

    const invalidExposure = new LatencyArbShadowExecutor(config, (event) => writes.push(event));
    expect(invalidExposure.evaluate({ market, signal, execution, nowMs: 1700000000100, currentExposureUsd: Number.NaN }))
      .toEqual({ ok: false, reason: 'invalid_current_exposure' });
    expect(invalidExposure.evaluate({ market, signal, execution, nowMs: 1700000000100, currentExposureUsd: -1 }))
      .toEqual({ ok: false, reason: 'invalid_current_exposure' });
  });

  it('should reject invalid signal numbers', () => {
    const writes: Record<string, unknown>[] = [];
    const executor = new LatencyArbShadowExecutor(config, (event) => writes.push(event));

    const result = executor.evaluate({
      market,
      signal: { ...signal, expectedValue: Number.NaN },
      execution,
      nowMs: 1700000000100,
      currentExposureUsd: 0,
    });

    expect(result).toEqual({ ok: false, reason: 'invalid_signal' });
  });

  it('should reject orders below exchange minimum token size', () => {
    const writes: Record<string, unknown>[] = [];
    const executor = new LatencyArbShadowExecutor(config, (event) => writes.push(event));

    const result = executor.evaluate({
      market,
      signal,
      execution: { ...execution, minOrderSize: 10 },
      nowMs: 1700000000100,
      currentExposureUsd: 0,
    });

    expect(result).toEqual({ ok: false, reason: 'order_below_min_size' });
  });

  it('should write skip when confidence is too low', () => {
    const writes: Record<string, unknown>[] = [];
    const executor = new LatencyArbShadowExecutor(config, (event) => writes.push(event));

    const result = executor.evaluate({
      market,
      signal: { ...signal, confidence: 0.5 },
      execution,
      nowMs: 1700000000100,
      currentExposureUsd: 0,
    });

    expect(result).toEqual({ ok: false, reason: 'confidence_too_low' });
    expect(writes[0]).toMatchObject({ eventType: 'skip', reason: 'confidence_too_low' });
  });

  it('should reject when exposure cap would be exceeded', () => {
    const writes: Record<string, unknown>[] = [];
    const executor = new LatencyArbShadowExecutor(config, (event) => writes.push(event));

    const result = executor.evaluate({ market, signal, execution, nowMs: 1700000000100, currentExposureUsd: 1.0 });

    expect(result).toEqual({ ok: false, reason: 'position_limit_exceeded' });
    expect(writes[0]).toMatchObject({ eventType: 'skip', reason: 'position_limit_exceeded' });
  });

  it('should not call any live submitter', () => {
    const liveSubmitter = { submit: jest.fn() };
    const executor = new LatencyArbShadowExecutor(config, () => undefined);

    executor.evaluate({ market, signal, execution, nowMs: 1700000000100, currentExposureUsd: 0 });

    expect(liveSubmitter.submit).not.toHaveBeenCalled();
  });
});
