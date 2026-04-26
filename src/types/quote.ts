export type Side = 'BUY' | 'SELL';
export type OrderType = 'GTC' | 'GTD';

export interface QuoteCandidate {
  conditionId: string;
  tokenId: string;
  side: Side;
  price: number;
  size: number;
  sizeUsd: number;
  orderType: OrderType;
  postOnly: true;
  expiresAt?: number | null;
  fairPrice: number;
  targetHalfSpreadCents: number;
  inventorySkewCents: number;
  toxicityScore: number;
  reason: string;
  riskFlags: string[];
}
