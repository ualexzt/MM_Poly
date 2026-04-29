import { BookState } from '../types/book';
import { QuoteCandidate } from '../types/quote';
import { RewardConfig } from '../types/market';
import { SpreadConfig, SizeConfig } from '../types/config';
import { roundDownToTick, roundUpToTick } from '../utils/math';

export interface QuoteEngineInputs {
  conditionId: string;
  tokenId: string;
  side: 'BUY' | 'SELL';

  fairPrice: number;
  book: BookState;

  spread: SpreadConfig;
  size: SizeConfig;

  toxicityScore: number;
  inventoryPct: number;      // 0-100 range matching spec
  inventorySkewCents: number;

  rewardConfig?: RewardConfig | null;
  isBookStale?: boolean;

  /** Optional: override computed half-spread (e.g. already widened by toxicity) */
  targetHalfSpreadCentsOverride?: number;
}

export interface QuoteEngineResult {
  candidate: QuoteCandidate;
  targetHalfSpreadCents: number;
}

/**
 * Compute target half-spread incorporating volatility, toxicity widening,
 * inventory widening and reward-aware tightening (§10.1, §10.2).
 */
export function computeTargetHalfSpread(
  spread: SpreadConfig,
  toxicityScore: number,
  inventoryPct: number,       // 0-100
  book: BookState,
  rewardConfig?: RewardConfig | null
): number {
  const tickCents = book.tickSize * 100;

  // Base half-spread = max(tick, base, adverse_selection_buffer) (§10.1)
  let halfSpreadCents = Math.max(
    tickCents * spread.minHalfSpreadTicks,
    spread.baseHalfSpreadCents,
    spread.adverseSelectionBufferCents
  );

  // Toxicity widening — proportional to score in [0.25, 1.0] range (§10)
  if (toxicityScore > 0.25) {
    const toxicityFactor = Math.min((toxicityScore - 0.25) / 0.75, 1.0);
    halfSpreadCents += spread.toxicityWideningMaxCents * toxicityFactor;
  }

  // Inventory widening (§9.4) — widen inventory-increasing side above soft limit
  if (inventoryPct > 35) {
    const invFactor = Math.min((inventoryPct - 35) / 65, 1.0);
    halfSpreadCents += spread.inventoryWideningMaxCents * invFactor;
  }

  // Reward-aware tightening (§10.2) — only when low toxicity
  if (
    rewardConfig?.enabled &&
    rewardConfig.maxIncentiveSpreadCents > 0 &&
    toxicityScore <= 0.25
  ) {
    const rewardTarget = rewardConfig.maxIncentiveSpreadCents * 0.85 / 2; // half-spread
    halfSpreadCents = Math.min(halfSpreadCents, rewardTarget);
  }

  // Never tighten below one tick (§10.2)
  halfSpreadCents = Math.max(halfSpreadCents, tickCents);

  return halfSpreadCents;
}

/**
 * Compute quote size with all multipliers (§10.6).
 */
function computeQuoteSize(
  size: SizeConfig,
  price: number,
  book: BookState,
  toxicityScore: number,
  inventoryPct: number,
  inventoryAction: 'below_soft_limit' | 'above_soft_limit' | 'above_hard_limit',
  side: 'BUY' | 'SELL',
  rewardConfig?: RewardConfig | null
): number {
  let sizeUsd = size.baseOrderSizeUsd;

  // Toxicity size multiplier (§10.6)
  if (toxicityScore >= 0.25 && toxicityScore < 0.45) {
    sizeUsd *= 0.5; // medium toxicity
  } else if (toxicityScore >= 0.45) {
    sizeUsd *= 0.25; // high/critical
  }

  // Inventory size multiplier (§10.6)
  if (inventoryAction === 'above_soft_limit') {
    // Reduce size on inventory-increasing side
    if (
      (side === 'BUY' && inventoryPct > 0) ||
      (side === 'SELL' && inventoryPct < 0)
    ) {
      sizeUsd *= 0.5;
    }
  }

  // Depth multiplier (§10.6)
  if (book.depth3Usd < 1000) {
    sizeUsd *= 0.5;
  }

  // Respect reward min incentive size (§10.6)
  if (size.respectRewardMinIncentiveSize && rewardConfig?.enabled && rewardConfig.minIncentiveSizeUsd > 0) {
    sizeUsd = Math.max(sizeUsd, rewardConfig.minIncentiveSizeUsd);
  }

  sizeUsd = Math.min(sizeUsd, size.maxOrderSizeUsd);

  const minSizeUsd = book.minOrderSize * price * size.minSizeMultiplierOverExchangeMin;
  sizeUsd = Math.max(sizeUsd, minSizeUsd);

  // Convert to token units
  const tokenSize = sizeUsd / price;
  const minTokens = book.minOrderSize;
  const maxTokens = size.maxOrderSizeUsd / price;

  const size_ = Math.max(Math.ceil(tokenSize), minTokens);
  return Math.min(size_, Math.floor(maxTokens));
}

/**
 * Determine if quote should improve by one tick based on placement policy (§10.5).
 */
function shouldImproveByOneTick(
  book: BookState,
  toxicityScore: number,
  inventoryPct: number,
  rewardConfig: RewardConfig | null | undefined,
  halfSpreadCents: number,
  side: 'BUY' | 'SELL'
): boolean {
  const spreadTicks = book.spreadTicks ?? 0;

  // Never improve conditions (§10.5)
  if (spreadTicks <= 2) return false;
  if (book.lastTradePrice !== null && book.lastTradePrice !== undefined) {
    // Approximation: if we have a recent last trade it might indicate activity
  }
  if (inventoryPct > 35) return false;

  // Conditions for improving by one tick (§10.5)
  if (spreadTicks < 5) return false;
  if (toxicityScore > 0.25) return false;
  if (Math.abs(inventoryPct) > 30) return false;

  // Verify still within reward spread
  if (rewardConfig?.enabled && rewardConfig.maxIncentiveSpreadCents > 0) {
    if (halfSpreadCents > rewardConfig.maxIncentiveSpreadCents / 2) return false;
  }

  return true;
}

/**
 * Main quote generation function (§10).
 * Returns a single QuoteCandidate or null if no valid quote can be generated.
 */
export function generateQuoteCandidate(inputs: QuoteEngineInputs): QuoteEngineResult | null {
  const {
    conditionId, tokenId, side,
    fairPrice, book, spread, size,
    toxicityScore, inventoryPct, inventorySkewCents,
    rewardConfig, isBookStale
  } = inputs;

  // Safety guards
  if (isBookStale) return null;
  if (!book.bestBid || !book.bestAsk) return null;

  const inventoryAction: 'below_soft_limit' | 'above_soft_limit' | 'above_hard_limit' =
    inventoryPct > 65 ? 'above_hard_limit' :
    inventoryPct > 35 ? 'above_soft_limit' :
    'below_soft_limit';

  // Compute target half-spread
  const halfSpreadCents = inputs.targetHalfSpreadCentsOverride ??
    computeTargetHalfSpread(spread, toxicityScore, inventoryPct, book, rewardConfig);

  const halfSpread = halfSpreadCents / 100;
  const skew = inventorySkewCents / 100;

  // Raw price calculation (§10.3)
  let rawPrice: number;
  if (side === 'BUY') {
    rawPrice = fairPrice - halfSpread - skew;
  } else {
    rawPrice = fairPrice + halfSpread - skew;
  }

  // Round to tick
  let price = side === 'BUY'
    ? roundDownToTick(rawPrice, book.tickSize)
    : roundUpToTick(rawPrice, book.tickSize);

  // Placement policy: improve by one tick if conditions allow (§10.5)
  if (shouldImproveByOneTick(book, toxicityScore, inventoryPct, rewardConfig, halfSpreadCents, side)) {
    if (side === 'BUY') price = roundDownToTick(price + book.tickSize, book.tickSize);
    else price = roundUpToTick(price - book.tickSize, book.tickSize);
  }

  // Post-only safety — ensure no spread crossing (§10.4)
  if (side === 'BUY' && price >= book.bestAsk) {
    price = roundDownToTick(book.bestAsk - book.tickSize, book.tickSize);
  }
  if (side === 'SELL' && price <= book.bestBid) {
    price = roundUpToTick(book.bestBid + book.tickSize, book.tickSize);
  }

  // Price must be in (0, 1)
  if (price <= 0 || price >= 1) return null;

  // Compute size
  const tokenSize = computeQuoteSize(size, price, book, toxicityScore, inventoryPct, inventoryAction, side, rewardConfig);
  if (tokenSize < book.minOrderSize) return null;

  const candidate: QuoteCandidate = {
    conditionId, tokenId, side,
    price,
    size: tokenSize,
    sizeUsd: tokenSize * price,
    orderType: 'GTC',
    postOnly: true,
    fairPrice,
    targetHalfSpreadCents: halfSpreadCents,
    inventorySkewCents,
    toxicityScore,
    reason: 'quote_generated',
    riskFlags: []
  };

  return { candidate, targetHalfSpreadCents: halfSpreadCents };
}

/**
 * @deprecated Use generateQuoteCandidate (singular) — kept for backward compat with tests.
 */
export function generateQuoteCandidates(inputs: {
  conditionId: string;
  tokenId: string;
  side: 'BUY' | 'SELL';
  fairPrice: number;
  targetHalfSpreadCents: number;
  inventorySkewCents: number;
  toxicityScore: number;
  book: BookState;
  baseSizeUsd: number;
  maxSizeUsd: number;
  minOrderSize: number;
  isBookStale?: boolean;
}): QuoteCandidate[] {
  const { conditionId, tokenId, side, fairPrice, targetHalfSpreadCents,
    inventorySkewCents, toxicityScore, book, baseSizeUsd, maxSizeUsd, minOrderSize, isBookStale } = inputs;

  if (isBookStale) return [];
  if (!book.bestBid || !book.bestAsk) return [];

  const halfSpread = targetHalfSpreadCents / 100;
  const skew = inventorySkewCents / 100;

  let rawPrice = side === 'BUY'
    ? fairPrice - halfSpread - skew
    : fairPrice + halfSpread - skew;

  let price = side === 'BUY'
    ? roundDownToTick(rawPrice, book.tickSize)
    : roundUpToTick(rawPrice, book.tickSize);

  if (side === 'BUY' && price >= book.bestAsk) {
    price = roundDownToTick(book.bestAsk - book.tickSize, book.tickSize);
  }
  if (side === 'SELL' && price <= book.bestBid) {
    price = roundUpToTick(book.bestBid + book.tickSize, book.tickSize);
  }

  if (price <= 0 || price >= 1) return [];

  let size = baseSizeUsd / price;
  size = Math.max(minOrderSize, Math.ceil(size));
  size = Math.min(size, Math.floor(maxSizeUsd / price));

  if (size < minOrderSize) return [];

  return [{
    conditionId, tokenId, side, price, size,
    sizeUsd: size * price,
    orderType: 'GTC',
    postOnly: true,
    fairPrice, targetHalfSpreadCents, inventorySkewCents, toxicityScore,
    reason: 'quote_generated',
    riskFlags: []
  }];
}
