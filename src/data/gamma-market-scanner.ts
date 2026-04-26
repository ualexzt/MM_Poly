import { MarketState } from '../types/market';

export interface MarketScanner {
  fetchMarkets(): Promise<MarketState[]>;
}

export class FixtureScanner implements MarketScanner {
  constructor(private fixturePath: string = './fixtures/markets.json') {}

  async fetchMarkets(): Promise<MarketState[]> {
    const data = require(this.fixturePath);
    return data as MarketState[];
  }
}

export class GammaApiScanner implements MarketScanner {
  constructor(private baseUrl: string = 'https://gamma-api.polymarket.com') {}

  async fetchMarkets(): Promise<MarketState[]> {
    const res = await fetch(`${this.baseUrl}/markets?active=true&closed=false`);
    if (!res.ok) throw new Error(`Gamma API error: ${res.status}`);
    return res.json() as Promise<MarketState[]>;
  }
}
