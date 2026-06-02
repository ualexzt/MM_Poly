import { MarketState } from '../types/market';
import { BookState } from '../types/book';

export interface PairCostConfig {
  maxPairCost: number;
  minEdgeBps: number;
  minLiquidityUsd: number;
  feeRate: number;
}

export interface PairCostOpportunity {
  conditionId: string;
  slug: string;
  question: string;
  yesPrice: number;
  noPrice: number;
  rawCost: number;
  allInCost: number;
  edgeBps: number;
  maxSizeUsd: number;
}

export function calculatePairCost(yesPrice: number, noPrice: number, feeRate: number): number {
  return (yesPrice + noPrice) * (1 + feeRate);
}

export function scanPairCostOpportunities(
  markets: MarketState[],
  orderbooks: Map<string, { yes: BookState; no: BookState }>,
  config: PairCostConfig,
): PairCostOpportunity[] {
  const opportunities: PairCostOpportunity[] = [];

  for (const market of markets) {
    if (!market.active || market.closed || !market.enableOrderBook) continue;
    if (!market.yesTokenId || !market.noTokenId) continue;

    const books = orderbooks.get(market.conditionId);
    if (!books) continue;

    const { yes: yesBook, no: noBook } = books;
    if (yesBook.bestAsk === null || noBook.bestAsk === null) continue;

    const maxSizeUsd = Math.min(yesBook.bestAskSizeUsd, noBook.bestAskSizeUsd);
    if (maxSizeUsd < config.minLiquidityUsd) continue;

    const feeRate = market.feeRate ?? config.feeRate;
    const rawCost = yesBook.bestAsk + noBook.bestAsk;
    const allInCost = calculatePairCost(yesBook.bestAsk, noBook.bestAsk, feeRate);
    if (allInCost >= config.maxPairCost) continue;

    const edgeBps = (1 - allInCost) * 10000;
    if (edgeBps < config.minEdgeBps) continue;

    opportunities.push({
      conditionId: market.conditionId,
      slug: market.slug || '',
      question: market.question || '',
      yesPrice: yesBook.bestAsk,
      noPrice: noBook.bestAsk,
      rawCost,
      allInCost,
      edgeBps,
      maxSizeUsd,
    });
  }

  return opportunities.sort((a, b) => b.edgeBps - a.edgeBps);
}
