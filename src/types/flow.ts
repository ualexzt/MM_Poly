export interface FlowState {
  conditionId: string;
  tokenId: string;
  trades10s: number;
  trades30s: number;
  trades60s: number;
  takerBuyVolume60sUsd: number;
  takerSellVolume60sUsd: number;
  largeTradeCount60s: number;
  midpointChange10sCents: number;
  midpointChange60sCents: number;
  bookHashChanges10s: number;
  wsDisconnectsLast5m: number;
  lastLargeTradeAtMs?: number | null;
}
