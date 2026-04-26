import { BookState } from '../types/book';

export interface OrderbookClient {
  fetchBook(conditionId: string, tokenId: string): Promise<BookState>;
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
    const res = await fetch(`${this.baseUrl}/book/${tokenId}?active=true`);
    if (!res.ok) throw new Error(`CLOB API error: ${res.status}`);
    return res.json() as Promise<BookState>;
  }
}
