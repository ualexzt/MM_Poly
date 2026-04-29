import { MarketState } from '../types/market';
import { BookState } from '../types/book';
import { FlowState } from '../types/flow';

/**
 * Market scoring formula from §5.
 *
 * market_score =
 *   0.25 * volume_score
 * + 0.20 * depth_score
 * + 0.20 * rebate_potential_score
 * + 0.15 * reward_potential_score
 * + 0.10 * spread_quality_score
 * + 0.10 * low_toxicity_score
 */

const WEIGHTS = {
  volume: 0.25,
  depth: 0.20,
  rebate: 0.20,
  reward: 0.15,
  spread: 0.10,
  toxicity: 0.10,
};

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Log-scale normalisation relative to a reference value (§5.1) */
function logScore(value: number, reference: number): number {
  if (value <= 0 || reference <= 0) return 0;
  return clamp01(Math.log(value + 1) / Math.log(reference + 1));
}

/** Volume score — log-normalised against $500k 24h reference (§5.1) */
function volumeScore(market: MarketState): number {
  return logScore(market.volume24hUsd, 500_000);
}

/** Depth score — average of depth1 and depth3 log-scores (§5.1) */
function depthScore(book: BookState): number {
  const d1 = logScore(book.depth1Usd, 5000);
  const d3 = logScore(book.depth3Usd, 20_000);
  return (d1 + d3) / 2;
}

/**
 * Rebate potential score (§5.1).
 * Hint: fee_rate * midpoint * (1 - midpoint) * estimated_flow
 * Normalised against a reference rebate value.
 */
function rebateScore(market: MarketState, book: BookState): number {
  const feeRate = market.feeRate ?? 0.002;
  const mid = book.midpoint ?? 0.5;
  const flow = market.volume24hUsd / 24; // rough hourly flow proxy
  const rebate = feeRate * mid * (1 - mid) * flow;
  return logScore(rebate, 50); // $50/h reference
}

/** Reward potential score (§5.1) */
function rewardScore(market: MarketState): number {
  const cfg = market.rewardConfig;
  if (!cfg?.enabled) return 0;
  const pool = cfg.rewardPoolUsd ?? 0;
  const spread = cfg.maxIncentiveSpreadCents;
  // Narrow max incentive spread = more competitive ⇒ score lower
  const spreadFactor = clamp01(1 - spread / 10);
  return clamp01(logScore(pool, 10_000) * 0.7 + spreadFactor * 0.3);
}

/**
 * Spread quality score (§5.1).
 * Hint: spread_after_tick_cost / realized_volatility
 * We approximate volatility from flow state if available.
 */
function spreadQualityScore(book: BookState, flow?: FlowState): number {
  if (!book.spread || book.spreadTicks === null) return 0;
  const spreadCents = book.spread * 100;
  // Use midpoint velocity as volatility proxy
  const volatility = flow ? Math.abs(flow.midpointChange60sCents) + 0.1 : 1.0;
  const ratio = spreadCents / volatility;
  return clamp01(ratio / 5); // score saturates at 5x spread/vol ratio
}

/**
 * Low-toxicity score (§5.1) — inverse of toxicity indicators.
 */
function lowToxicityScore(flow?: FlowState): number {
  if (!flow) return 0.5; // neutral when no data
  const tradeBurst = clamp01(flow.trades10s / 15);
  const midVelocity = clamp01(Math.abs(flow.midpointChange60sCents) / 5);
  const imbalance = flow.takerBuyVolume60sUsd + flow.takerSellVolume60sUsd > 0
    ? clamp01(Math.abs(flow.takerBuyVolume60sUsd - flow.takerSellVolume60sUsd)
        / (flow.takerBuyVolume60sUsd + flow.takerSellVolume60sUsd))
    : 0;
  const largeTrade = clamp01(flow.largeTradeCount60s / 5);
  const hashInstability = clamp01(flow.bookHashChanges10s / 15);

  const rawToxicity = 0.25 * tradeBurst + 0.20 * midVelocity + 0.20 * imbalance +
    0.15 * largeTrade + 0.10 * hashInstability;

  return clamp01(1 - rawToxicity); // invert: high toxicity → low score
}

export interface MarketScore {
  conditionId: string;
  score: number;
  components: {
    volume: number;
    depth: number;
    rebate: number;
    reward: number;
    spread: number;
    toxicity: number;
  };
}

/**
 * Compute the market score for a single market (§5).
 */
export function scoreMarket(
  market: MarketState,
  book: BookState,
  flow?: FlowState
): MarketScore {
  const v = volumeScore(market);
  const d = depthScore(book);
  const r = rebateScore(market, book);
  const rw = rewardScore(market);
  const s = spreadQualityScore(book, flow);
  const t = lowToxicityScore(flow);

  const score =
    WEIGHTS.volume * v +
    WEIGHTS.depth * d +
    WEIGHTS.rebate * r +
    WEIGHTS.reward * rw +
    WEIGHTS.spread * s +
    WEIGHTS.toxicity * t;

  return {
    conditionId: market.conditionId,
    score: clamp01(score),
    components: { volume: v, depth: d, rebate: r, reward: rw, spread: s, toxicity: t }
  };
}

/**
 * Rank a list of eligible markets by score descending.
 */
export function rankMarkets(
  markets: MarketState[],
  books: Map<string, BookState>,
  flows?: Map<string, FlowState>
): Array<{ market: MarketState; score: MarketScore }> {
  const scored = markets.map(m => {
    const book = books.get(m.yesTokenId);
    if (!book) return null;
    const flow = flows?.get(m.yesTokenId);
    const score = scoreMarket(m, book, flow);
    return { market: m, score };
  }).filter((x): x is { market: MarketState; score: MarketScore } => x !== null);

  return scored.sort((a, b) => b.score.score - a.score.score);
}
