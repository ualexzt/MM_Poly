export interface BookLevel {
  price: number;
  size: number;
  sizeUsd: number;
}

export interface BookState {
  tokenId: string;
  conditionId: string;
  bids: BookLevel[];
  asks: BookLevel[];
  bestBid: number | null;
  bestAsk: number | null;
  bestBidSizeUsd: number;
  bestAskSizeUsd: number;
  midpoint: number | null;
  spread: number | null;
  spreadTicks: number | null;
  depth1Usd: number;
  depth3Usd: number;
  tickSize: number;
  minOrderSize: number;
  lastTradePrice?: number | null;
  orderbookHash?: string | null;
  lastUpdateMs: number;
}
