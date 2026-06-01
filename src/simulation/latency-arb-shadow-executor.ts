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

export class LatencyArbShadowExecutor {
  private orderCounter = 0;

  constructor(private readonly config: ShadowExecutorConfig, private readonly writeEvent: WriteEvent) {}

  evaluate(input: ShadowExecutorInput): ShadowExecutorResult {
    if (input.signal.action === 'NO_ACTION') return this.skip(input, input.signal.rejectionReason ?? 'no_action');
    if (input.signal.confidence < this.config.minConfidence) return this.skip(input, 'confidence_too_low');

    const makerPrice = input.signal.action === 'BUY_YES'
      ? input.execution.yesBestBid
      : input.execution.noBestBid;
    const takerPrice = input.signal.action === 'BUY_YES'
      ? input.execution.yesBestAsk
      : input.execution.noBestAsk;

    if (!finitePositive(makerPrice) || !finitePositive(takerPrice)) return this.skip(input, 'invalid_execution_price');

    const targetSizeUsd = Math.min(
      this.config.startingBalanceUsd * this.config.orderBalanceFraction,
      this.config.maxOrderSizeUsd
    );
    if (!finitePositive(targetSizeUsd)) return this.skip(input, 'invalid_order_size');

    if (input.currentExposureUsd + targetSizeUsd > this.config.maxPositionUsd) {
      return this.skip(input, 'position_limit_exceeded');
    }

    const orderId = `shadow-${++this.orderCounter}`;
    const shares = targetSizeUsd / makerPrice;
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
      orderType: 'post_only_limit',
      makerPrice,
      makerEvPct,
      takerPrice,
      takerEvPct,
      sizeUsd: targetSizeUsd,
      shares,
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
