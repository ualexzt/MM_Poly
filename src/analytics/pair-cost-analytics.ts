import { getExecutableBuyPrice } from '../engines/executable-price';
import { BookState } from '../types/book';
import { MarketState } from '../types/market';

export interface PairCostAnalyticsConfig {
  enabled: boolean;
  sampleUsd: number[];
  maxPairCost: number;
  minEdgePerPair: number;
}

export type PairCostAnalyticsEvent = Record<string, unknown>;

interface BuildPairCostAnalyticsEventsInput {
  market: MarketState;
  yesBook: BookState;
  noBook: BookState;
  config: PairCostAnalyticsConfig;
  now: Date;
}

const ROUND_FACTOR = 1_000_000_000;

function round(value: number): number {
  return Math.round(value * ROUND_FACTOR) / ROUND_FACTOR;
}

function timeToCloseSeconds(market: MarketState, now: Date): number | null {
  if (!market.endDate) return null;
  const endMs = Date.parse(market.endDate);
  if (!Number.isFinite(endMs)) return null;
  return Math.max(0, Math.floor((endMs - now.getTime()) / 1000));
}

function orderbookAgeMs(book: BookState, now: Date): number {
  return Math.max(0, now.getTime() - book.lastUpdateMs);
}

export function buildPairCostAnalyticsEvents(input: BuildPairCostAnalyticsEventsInput): PairCostAnalyticsEvent[] {
  if (!input.config.enabled) return [];

  const events: PairCostAnalyticsEvent[] = [];
  const sampleUsd = input.config.sampleUsd
    .filter(size => Number.isFinite(size) && size > 0)
    .sort((a, b) => a - b);

  for (const sample of sampleUsd) {
    const requestedQty = round(sample);
    const yesExec = getExecutableBuyPrice(input.yesBook, 'YES', requestedQty);
    const noExec = getExecutableBuyPrice(input.noBook, 'NO', requestedQty);
    const enoughDepth = yesExec.enoughDepth && noExec.enoughDepth;
    const minOrderSizeSatisfied = requestedQty >= input.yesBook.minOrderSize && requestedQty >= input.noBook.minOrderSize;
    const pairCost = round(yesExec.avgPrice + noExec.avgPrice);
    const edgePerPair = round(1 - pairCost);
    const opportunity = enoughDepth && minOrderSizeSatisfied && pairCost <= input.config.maxPairCost && edgePerPair >= input.config.minEdgePerPair;

    const snapshot = {
      eventType: 'pair_cost_executable_snapshot',
      strategy: 'pair_cost',
      timestamp: input.now.toISOString(),
      marketId: input.market.conditionId,
      slug: input.market.slug ?? '',
      question: input.market.question ?? '',
      timeToCloseSeconds: timeToCloseSeconds(input.market, input.now),
      sampleUsd: sample,
      requestedQty,
      yesExecutableQty: yesExec.executableQty,
      noExecutableQty: noExec.executableQty,
      yesAvgPrice: yesExec.avgPrice,
      noAvgPrice: noExec.avgPrice,
      yesWorstPrice: yesExec.worstPrice,
      noWorstPrice: noExec.worstPrice,
      yesTotalCost: yesExec.totalCost,
      noTotalCost: noExec.totalCost,
      pairCost,
      edgePerPair,
      enoughDepth,
      minOrderSizeSatisfied,
      opportunity,
      yesSpread: input.yesBook.spread,
      noSpread: input.noBook.spread,
      yesDepthUsd: input.yesBook.depth3Usd,
      noDepthUsd: input.noBook.depth3Usd,
      yesOrderbookAgeMs: orderbookAgeMs(input.yesBook, input.now),
      noOrderbookAgeMs: orderbookAgeMs(input.noBook, input.now),
    };

    events.push(snapshot);

    if (opportunity) {
      events.push({
        eventType: 'pair_cost_opportunity_detected',
        strategy: 'pair_cost',
        timestamp: input.now.toISOString(),
        marketId: input.market.conditionId,
        slug: input.market.slug ?? '',
        sampleUsd: sample,
        requestedQty,
        pairCost,
        edgePerPair,
        yesAvgPrice: yesExec.avgPrice,
        noAvgPrice: noExec.avgPrice,
        yesWorstPrice: yesExec.worstPrice,
        noWorstPrice: noExec.worstPrice,
      });
    }
  }

  return events;
}
