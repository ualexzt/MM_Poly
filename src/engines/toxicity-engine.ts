import { FlowState } from '../types/flow';
import { ToxicityConfig } from '../types/config';

export type ToxicityAction = 'quote_normally' | 'widen_quotes' | 'quote_exit_only_or_cancel' | 'cancel_all_market_orders';

export interface HardToxicityInputs {
  midpointMove10sCents: number;
  midpointMove60sCents: number;
  largeTradeUsd: number;
  bookHashChanges10s: number;
  spreadTicks: number;
  bookStaleMs: number;
  wsDisconnectedSeconds: number;
}

function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

export function computeToxicityScore(flow: FlowState): number {
  const tradeBurst = normalize(flow.trades10s, 0, 15);
  const midpointVelocity = normalize(Math.abs(flow.midpointChange60sCents), 0, 5);
  const imbalance = normalize(
    Math.abs(flow.takerBuyVolume60sUsd - flow.takerSellVolume60sUsd) / Math.max(flow.takerBuyVolume60sUsd + flow.takerSellVolume60sUsd, 1),
    0, 1
  );
  const largeTrade = normalize(flow.largeTradeCount60s, 0, 5);
  const bookInstability = normalize(flow.bookHashChanges10s, 0, 15);
  const externalEvent = normalize(flow.wsDisconnectsLast5m, 0, 3);

  const score =
    0.25 * tradeBurst +
    0.20 * midpointVelocity +
    0.20 * imbalance +
    0.15 * largeTrade +
    0.10 * bookInstability +
    0.10 * externalEvent;

  return Math.max(0, Math.min(1, score));
}

export function getToxicityAction(score: number): ToxicityAction {
  if (score >= 0.65) return 'cancel_all_market_orders';
  if (score >= 0.45) return 'quote_exit_only_or_cancel';
  if (score >= 0.25) return 'widen_quotes';
  return 'quote_normally';
}

export function checkHardToxicityCancel(inputs: HardToxicityInputs, config: ToxicityConfig): boolean {
  if (inputs.midpointMove10sCents >= config.cancelIfMidpointMoves10sCentsGte) return true;
  if (inputs.midpointMove60sCents >= config.cancelIfMidpointMoves60sCentsGte) return true;
  if (inputs.largeTradeUsd >= config.cancelIfLargeTradeUsdGte) return true;
  if (inputs.bookHashChanges10s >= config.cancelIfHashChanges10sGte) return true;
  if (inputs.spreadTicks <= config.cancelIfSpreadTicksLte) return true;
  return false;
}
