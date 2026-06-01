import { DivergenceSignal } from '../engines/divergence-engine';
import { MarketState } from '../types/market';
import { LatencyArbExecutionSnapshot } from '../strategy/latency-arb-orderbook';

export interface ShadowExecutorConfig {
  mode: 'paper' | 'shadow';
  asset: 'BTC';
  duration: '15m';
  startingBalanceUsd: number;
  orderBalanceFraction: number;
  maxOrderSizeUsd: number;
  maxPositionUsd: number;
  minConfidence: number;
}

export interface ShadowExecutorInput {
  market: MarketState;
  signal: DivergenceSignal;
  execution: LatencyArbExecutionSnapshot;
  nowMs: number;
  currentExposureUsd: number;
}

export type ShadowExecutorResult =
  | { ok: true; orderId: string; sizeUsd: number }
  | { ok: false; reason: string };

type WriteEvent = (event: Record<string, unknown>) => void;

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function validBinaryPrice(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= 1;
}

function validRatio(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= 1;
}

function validNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

export class LatencyArbShadowExecutor {
  private orderCounter = 0;

  constructor(private readonly config: ShadowExecutorConfig, private readonly writeEvent: WriteEvent) {}

  evaluate(input: ShadowExecutorInput): ShadowExecutorResult {
    if (
      !finitePositive(this.config.startingBalanceUsd) ||
      !validRatio(this.config.orderBalanceFraction) ||
      !finitePositive(this.config.maxOrderSizeUsd) ||
      !finitePositive(this.config.maxPositionUsd) ||
      !validNonNegative(this.config.minConfidence) ||
      this.config.minConfidence > 1
    ) return this.skip(input, 'invalid_risk_config');

    if (!validNonNegative(input.currentExposureUsd)) return this.skip(input, 'invalid_current_exposure');

    if (input.signal.action === 'NO_ACTION') return this.skip(input, input.signal.rejectionReason ?? 'no_action');

    if (
      !Number.isFinite(input.signal.expectedValue) ||
      !Number.isFinite(input.signal.expectedValuePct) ||
      !Number.isFinite(input.signal.divergencePct) ||
      !Number.isFinite(input.signal.entryPrice) ||
      !Number.isFinite(input.signal.confidence)
    ) return this.skip(input, 'invalid_signal');

    if (input.signal.confidence < this.config.minConfidence) return this.skip(input, 'confidence_too_low');

    const makerPrice = input.signal.action === 'BUY_YES'
      ? input.execution.yesBestBid
      : input.execution.noBestBid;
    const takerPrice = input.signal.action === 'BUY_YES'
      ? input.execution.yesBestAsk
      : input.execution.noBestAsk;

    if (!validBinaryPrice(makerPrice) || !validBinaryPrice(takerPrice)) return this.skip(input, 'invalid_execution_price');
    if (!finitePositive(input.execution.minOrderSize)) return this.skip(input, 'invalid_execution_min_order_size');

    const targetSizeUsd = Math.min(
      this.config.startingBalanceUsd * this.config.orderBalanceFraction,
      this.config.maxOrderSizeUsd
    );
    if (!finitePositive(targetSizeUsd)) return this.skip(input, 'invalid_order_size');

    const projectedExposureUsd = input.currentExposureUsd + targetSizeUsd;
    if (projectedExposureUsd > this.config.maxPositionUsd) {
      return this.skip(input, 'position_limit_exceeded');
    }

    const shares = targetSizeUsd / makerPrice;
    if (shares < input.execution.minOrderSize) return this.skip(input, 'order_below_min_size');

    const orderId = `shadow-${++this.orderCounter}`;
    const makerEvPct = ((input.signal.expectedValue + (input.signal.entryPrice - makerPrice)) / makerPrice) * 100;
    const takerEvPct = ((input.signal.expectedValue + (input.signal.entryPrice - takerPrice)) / takerPrice) * 100;

    this.writeEvent({
      eventType: 'would_place_order',
      orderId,
      timestamp: input.nowMs,
      mode: this.config.mode,
      asset: this.config.asset,
      duration: this.config.duration,
      conditionId: input.market.conditionId,
      slug: input.market.slug,
      question: input.market.question,
      action: input.signal.action,
      tokenId: input.signal.action === 'BUY_YES' ? input.market.yesTokenId : input.market.noTokenId,
      side: 'BUY',
      orderType: 'post_only_limit',
      makerPrice,
      makerEvPct,
      takerPrice,
      takerEvPct,
      sizeUsd: targetSizeUsd,
      shares,
      currentExposureUsd: input.currentExposureUsd,
      projectedExposureUsd,
      minOrderSize: input.execution.minOrderSize,
      confidence: input.signal.confidence,
      divergencePct: input.signal.divergencePct,
      expectedValuePct: input.signal.expectedValuePct,
    });

    return { ok: true, orderId, sizeUsd: targetSizeUsd };
  }

  private skip(input: ShadowExecutorInput, reason: string): ShadowExecutorResult {
    this.writeEvent({
      eventType: 'skip',
      timestamp: input.nowMs,
      conditionId: input.market.conditionId,
      action: input.signal.action,
      reason,
    });
    return { ok: false, reason };
  }
}
