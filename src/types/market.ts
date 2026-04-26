export interface RewardConfig {
  enabled: boolean;
  minIncentiveSizeUsd: number;
  maxIncentiveSpreadCents: number;
  rewardPoolUsd?: number | null;
}

export interface MarketState {
  conditionId: string;
  eventId?: string;
  slug?: string;
  question?: string;
  yesTokenId: string;
  noTokenId: string;
  active: boolean;
  closed: boolean;
  enableOrderBook: boolean;
  feesEnabled: boolean;
  negRisk?: boolean;
  category?: string;
  endDate?: string;
  resolutionSource?: string;
  volume24hUsd: number;
  liquidityUsd: number;
  feeRate?: number;
  makerRebateRate?: number;
  rewardConfig?: RewardConfig | null;
  oracleAmbiguityScore: number;
  knownCatalystAt?: number | null;
}
