export type InventoryThrottleMode = 'paper' | 'shadow' | 'small_live' | 'disabled';
export type QuoteSide = 'BUY' | 'SELL';

export interface InventoryThrottleTier {
  startPct: number;
  sizeMultiplier: number;
  extraHalfSpreadCents: number;
  blockNewInventory?: boolean;
}

export interface InventoryThrottleProfile {
  reduceOnlyThresholdPct: number;
  tiers: InventoryThrottleTier[];
}

export interface InventoryThrottleProfiles {
  paper: InventoryThrottleProfile;
  small_live: InventoryThrottleProfile;
}

export interface InventoryThrottleInput {
  mode: InventoryThrottleMode;
  profiles: InventoryThrottleProfiles;
  netPosition: number;
  inventoryUsagePct: number | null;
  side: QuoteSide;
}

export interface InventoryThrottleResult {
  isInventoryIncreasing: boolean;
  sizeMultiplier: number;
  extraHalfSpreadCents: number;
  blocked: boolean;
  reduceOnly: boolean;
}

const NO_THROTTLE: InventoryThrottleResult = {
  isInventoryIncreasing: false,
  sizeMultiplier: 1,
  extraHalfSpreadCents: 0,
  blocked: false,
  reduceOnly: false,
};

export function getInventoryThrottleProfile(
  mode: InventoryThrottleMode,
  profiles: InventoryThrottleProfiles
): InventoryThrottleProfile {
  return mode === 'small_live' ? profiles.small_live : profiles.paper;
}

export function computeInventoryThrottle(input: InventoryThrottleInput): InventoryThrottleResult {
  const { netPosition, inventoryUsagePct, side } = input;
  if (netPosition === 0 || inventoryUsagePct === null) return NO_THROTTLE;

  const isInventoryIncreasing =
    (netPosition > 0 && side === 'BUY') ||
    (netPosition < 0 && side === 'SELL');

  if (!isInventoryIncreasing) return NO_THROTTLE;

  const profile = getInventoryThrottleProfile(input.mode, input.profiles);
  const reduceOnly = inventoryUsagePct >= profile.reduceOnlyThresholdPct;
  let selectedTier: InventoryThrottleTier | null = null;

  for (const tier of profile.tiers) {
    if (inventoryUsagePct >= tier.startPct) {
      selectedTier = tier;
    }
  }

  if (!selectedTier && !reduceOnly) {
    return {
      isInventoryIncreasing: true,
      sizeMultiplier: 1,
      extraHalfSpreadCents: 0,
      blocked: false,
      reduceOnly: false,
    };
  }

  return {
    isInventoryIncreasing: true,
    sizeMultiplier: selectedTier?.sizeMultiplier ?? 0,
    extraHalfSpreadCents: selectedTier?.extraHalfSpreadCents ?? 0,
    blocked: reduceOnly || Boolean(selectedTier?.blockNewInventory),
    reduceOnly,
  };
}
