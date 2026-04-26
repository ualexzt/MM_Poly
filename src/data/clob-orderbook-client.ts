import { BookState, BookLevel } from '../types/book';

export interface OrderbookClient {
  fetchBook(conditionId: string, tokenId: string): Promise<BookState>;
}

function mapClobBook(data: any, tokenId: string, conditionId: string): BookState {
  const bids: BookLevel[] = (data.bids || []).map((b: any) => ({
    price: parseFloat(b.price),
    size: parseFloat(b.size),
    sizeUsd: parseFloat(b.price) * parseFloat(b.size)
  }));
  const asks: BookLevel[] = (data.asks || []).map((a: any) => ({
    price: parseFloat(a.price),
    size: parseFloat(a.size),
    sizeUsd: parseFloat(a.price) * parseFloat(a.size)
  }));

  const bestBid = bids.length > 0 ? bids[0].price : null;
  const bestAsk = asks.length > 0 ? asks[0].price : null;
  const midpoint = bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : null;
  const spread = bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;

  // CLOB tick size is usually 0.01 for most markets
  const tickSize = 0.01;
  const minOrderSize = 1;

  return {
    tokenId,
    conditionId,
    bids,
    asks,
    bestBid,
    bestAsk,
    bestBidSizeUsd: bids.length > 0 ? bids[0].sizeUsd : 0,
    bestAskSizeUsd: asks.length > 0 ? asks[0].sizeUsd : 0,
    midpoint,
    spread,
    spreadTicks: spread !== null ? Math.round(spread / tickSize) : null,
    depth1Usd: (bids[0]?.sizeUsd || 0) + (asks[0]?.sizeUsd || 0),
    depth3Usd: bids.slice(0, 3).reduce((s, b) => s + b.sizeUsd, 0) + asks.slice(0, 3).reduce((s, a) => s + a.sizeUsd, 0),
    tickSize,
    minOrderSize,
    orderbookHash: data.hash || null,
    lastUpdateMs: parseInt(data.timestamp) || Date.now()
  };
}

export class FixtureOrderbookClient implements OrderbookClient {
  constructor(private fixturePath: string = './fixtures/orderbook.json') {}

  async fetchBook(): Promise<BookState> {
    const data = require(this.fixturePath);
    return { ...data, lastUpdateMs: Date.now() } as BookState;
  }
}

export class ClobApiClient implements OrderbookClient {
  constructor(private baseUrl: string = 'https://clob.polymarket.com') {}

  async fetchBook(conditionId: string, tokenId: string): Promise<BookState> {
    const res = await fetch(`${this.baseUrl}/book?token_id=${tokenId}`);
    if (!res.ok) throw new Error(`CLOB API error: ${res.status}`);
    const data = await res.json();
    return mapClobBook(data, tokenId, conditionId);
  }
}
