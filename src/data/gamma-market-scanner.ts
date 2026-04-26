import { MarketState } from '../types/market';

export interface MarketScanner {
  fetchMarkets(): Promise<MarketState[]>;
}

function mapGammaMarket(m: any): MarketState {
  let tokens: string[] = [];
  if (typeof m.clobTokenIds === 'string') {
    try { tokens = JSON.parse(m.clobTokenIds); } catch { tokens = []; }
  } else if (Array.isArray(m.clobTokenIds)) {
    tokens = m.clobTokenIds;
  }
  return {
    conditionId: m.conditionId || '',
    question: m.question || '',
    yesTokenId: tokens[0] || '',
    noTokenId: tokens[1] || '',
    active: m.active === true,
    closed: m.closed === true,
    enableOrderBook: tokens.length >= 2,
    feesEnabled: true,
    volume24hUsd: m.volume24hr || 0,
    liquidityUsd: m.liquidityClob || 0,
    oracleAmbiguityScore: 0.05,
    feeRate: m.feeRate || 0.002,
    makerRebateRate: m.makerRebateRate || 0.001
  };
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
    const res = await fetch(
      `${this.baseUrl}/markets?active=true&closed=false&limit=50`
    );
    if (!res.ok) throw new Error(`Gamma API error: ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Gamma API: unexpected response');
    return data.map(mapGammaMarket);
  }
}
