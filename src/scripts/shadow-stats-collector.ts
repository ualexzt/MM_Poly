import 'dotenv/config';
import { mkdir, writeFile, appendFile } from 'fs/promises';
import path from 'path';
import { env } from '../config/env';
import { GammaApiScanner } from '../data/gamma-market-scanner';
import { ClobApiClient } from '../data/clob-orderbook-client';
import { defaultConfig } from '../strategy/config';
import { filterEligibleMarkets, isMarketEligible } from '../strategy/market-selector';
import { computeFairPrice } from '../engines/fair-price-engine';
import { generateQuoteCandidate } from '../engines/quote-engine';
import type { BookState } from '../types/book';
import type { MarketState } from '../types/market';
import type { MarketFilterConfig } from '../types/config';
import type { QuoteCandidate } from '../types/quote';

export interface ShadowStatsCollectorOptions {
  durationMinutes: number;
  intervalSeconds: number;
  minSpreadTicks: number;
  maxMarketsPerCycle: number;
  outputDir: string;
}

export interface ShadowCandidateStats {
  timestamp: string;
  marketQuestion: string;
  slug?: string;
  conditionId: string;
  tokenId: string;
  side: 'BUY' | 'SELL';
  requiresInventory: boolean;
  bestBid: number | null;
  bestAsk: number | null;
  midpoint: number | null;
  spread: number | null;
  spreadTicks: number | null;
  depth1Usd: number;
  depth3Usd: number;
  minOrderUsd: number;
  fairPrice: number;
  quotePrice: number;
  quoteSize: number;
  quoteSizeUsd: number;
  edgeToFairCents: number;
  targetHalfSpreadCents: number;
}

export function buildStatsMarketFilter(minSpreadTicks: number): MarketFilterConfig {
  return {
    ...defaultConfig.marketFilter,
    minSpreadTicks,
  };
}

export function toCandidateStats(params: {
  timestamp: string;
  market: MarketState;
  book: BookState;
  quote: QuoteCandidate;
  targetHalfSpreadCents: number;
}): ShadowCandidateStats {
  const { timestamp, market, book, quote, targetHalfSpreadCents } = params;
  const minOrderUsd = book.minOrderSize * (book.midpoint ?? quote.price);
  const edgeToFairCents = quote.side === 'BUY'
    ? (quote.fairPrice - quote.price) * 100
    : (quote.price - quote.fairPrice) * 100;

  return {
    timestamp,
    marketQuestion: market.question ?? market.conditionId,
    slug: market.slug,
    conditionId: market.conditionId,
    tokenId: quote.tokenId,
    side: quote.side,
    requiresInventory: quote.side === 'SELL',
    bestBid: book.bestBid,
    bestAsk: book.bestAsk,
    midpoint: book.midpoint,
    spread: book.spread,
    spreadTicks: book.spreadTicks,
    depth1Usd: book.depth1Usd,
    depth3Usd: book.depth3Usd,
    minOrderUsd,
    fairPrice: quote.fairPrice,
    quotePrice: quote.price,
    quoteSize: quote.size,
    quoteSizeUsd: quote.sizeUsd,
    edgeToFairCents,
    targetHalfSpreadCents,
  };
}

function parseNumberEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Invalid ${key}: ${raw}`);
  return parsed;
}

function collectorOptionsFromEnv(): ShadowStatsCollectorOptions {
  return {
    durationMinutes: parseNumberEnv('SHADOW_STATS_DURATION_MINUTES', 60),
    intervalSeconds: parseNumberEnv('SHADOW_STATS_INTERVAL_SECONDS', 60),
    minSpreadTicks: parseNumberEnv('SHADOW_STATS_MIN_SPREAD_TICKS', 1),
    maxMarketsPerCycle: parseNumberEnv('SHADOW_STATS_MAX_MARKETS_PER_CYCLE', 5),
    outputDir: process.env.SHADOW_STATS_OUTPUT_DIR || 'logs/shadow-stats',
  };
}

async function collectOnce(params: {
  scanner: GammaApiScanner;
  bookClient: ClobApiClient;
  marketFilter: MarketFilterConfig;
  maxMarketsPerCycle: number;
  jsonlPath: string;
}): Promise<{ basicEligible: number; bookEligible: number; candidates: number; errors: number }> {
  const { scanner, bookClient, marketFilter, maxMarketsPerCycle, jsonlPath } = params;
  const markets = await scanner.fetchMarkets();
  const basicEligible = filterEligibleMarkets(markets, marketFilter);
  const timestamp = new Date().toISOString();
  let bookEligible = 0;
  let candidates = 0;
  let errors = 0;

  for (const market of basicEligible) {
    if (bookEligible >= maxMarketsPerCycle) break;

    try {
      const yesBook = await bookClient.fetchBook(market.conditionId, market.yesTokenId);
      const noBook = await bookClient.fetchBook(market.conditionId, market.noTokenId);
      const books = new Map<string, BookState>([
        [market.yesTokenId, yesBook],
        [market.noTokenId, noBook],
      ]);

      if (!isMarketEligible(market, marketFilter, books)) continue;
      if (yesBook.bestBid === null || yesBook.bestAsk === null) continue;

      const fair = computeFairPrice({
        bestBid: yesBook.bestBid,
        bestAsk: yesBook.bestAsk,
        bestBidSize: yesBook.bestBidSizeUsd,
        bestAskSize: yesBook.bestAskSizeUsd,
        lastTradeEma: yesBook.lastTradePrice ?? null,
        complementMidpoint: noBook.midpoint,
        weights: defaultConfig.fairPrice.weights,
      });
      if (!fair) continue;

      bookEligible += 1;
      for (const side of ['BUY', 'SELL'] as const) {
        const quote = generateQuoteCandidate({
          conditionId: market.conditionId,
          tokenId: market.yesTokenId,
          side,
          fairPrice: fair.fairPrice,
          book: yesBook,
          spread: defaultConfig.spread,
          size: defaultConfig.size,
          toxicityScore: 0.1,
          inventoryPct: 0,
          inventorySkewCents: 0,
          rewardConfig: market.rewardConfig ?? null,
          isBookStale: false,
        });
        if (!quote) continue;

        candidates += 1;
        await appendFile(jsonlPath, JSON.stringify({
          type: 'candidate',
          ...toCandidateStats({
            timestamp,
            market,
            book: yesBook,
            quote: quote.candidate,
            targetHalfSpreadCents: quote.targetHalfSpreadCents,
          }),
        }) + '\n');
      }
    } catch (err) {
      errors += 1;
      await appendFile(jsonlPath, JSON.stringify({
        type: 'market_error',
        timestamp,
        conditionId: market.conditionId,
        slug: market.slug,
        error: String(err),
      }) + '\n');
    }
  }

  await appendFile(jsonlPath, JSON.stringify({
    type: 'cycle_summary',
    timestamp,
    totalMarkets: markets.length,
    basicEligible: basicEligible.length,
    bookEligible,
    candidates,
    errors,
  }) + '\n');

  return { basicEligible: basicEligible.length, bookEligible, candidates, errors };
}

async function main(): Promise<void> {
  if (env.mode !== 'shadow' || env.liveTradingEnabled) {
    throw new Error(`Refusing to collect shadow stats unless MODE=shadow and LIVE_TRADING_ENABLED=false (got mode=${env.mode}, live=${env.liveTradingEnabled})`);
  }

  const options = collectorOptionsFromEnv();
  const startedAt = new Date();
  const runId = startedAt.toISOString().replace(/[:.]/g, '-');
  const outputDir = path.resolve(options.outputDir);
  await mkdir(outputDir, { recursive: true });
  const jsonlPath = path.join(outputDir, `shadow-candidates-${runId}.jsonl`);
  const summaryPath = path.join(outputDir, `shadow-candidates-${runId}-summary.json`);

  const scanner = new GammaApiScanner();
  const bookClient = new ClobApiClient();
  const marketFilter = buildStatsMarketFilter(options.minSpreadTicks);
  const cycles = Math.max(1, Math.floor((options.durationMinutes * 60) / options.intervalSeconds));
  const cycleSummaries: Array<{ basicEligible: number; bookEligible: number; candidates: number; errors: number }> = [];

  console.log(JSON.stringify({ type: 'collector_start', jsonlPath, summaryPath, options }));

  for (let cycle = 0; cycle < cycles; cycle += 1) {
    const summary = await collectOnce({ scanner, bookClient, marketFilter, maxMarketsPerCycle: options.maxMarketsPerCycle, jsonlPath });
    cycleSummaries.push(summary);
    console.log(JSON.stringify({ type: 'collector_cycle', cycle: cycle + 1, cycles, ...summary }));
    if (cycle < cycles - 1) await new Promise((resolve) => setTimeout(resolve, options.intervalSeconds * 1000));
  }

  const aggregate = cycleSummaries.reduce((acc, item) => ({
    cycles: acc.cycles + 1,
    basicEligibleTotal: acc.basicEligibleTotal + item.basicEligible,
    bookEligibleTotal: acc.bookEligibleTotal + item.bookEligible,
    candidatesTotal: acc.candidatesTotal + item.candidates,
    errorsTotal: acc.errorsTotal + item.errors,
  }), { cycles: 0, basicEligibleTotal: 0, bookEligibleTotal: 0, candidatesTotal: 0, errorsTotal: 0 });

  await writeFile(summaryPath, JSON.stringify({
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    options,
    jsonlPath,
    aggregate,
  }, null, 2));

  console.log(JSON.stringify({ type: 'collector_done', summaryPath, aggregate }));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
