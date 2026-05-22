# Inventory Throttle Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add mode-specific inventory throttle profiles that reduce inventory-increasing quotes while preserving exit-side quoting.

**Architecture:** Add a small pure throttle module that computes side-aware quote adjustments from position, usage, and mode. Wire that module into quote generation through typed config and use the same profile thresholds for reduce-only risk decisions. Keep the change surgical: no fair-price, toxicity, market selection, or portfolio optimizer changes.

**Tech Stack:** TypeScript, Jest, Docker-based npm commands, existing pure engine/risk/config layout.

---

## File Structure

- Create `src/engines/inventory-throttle.ts`
  - Owns pure throttle profile selection and side-aware throttle computation.
  - Exports `InventoryThrottleProfile`, `InventoryThrottleTier`, `InventoryThrottleResult`, `getInventoryThrottleProfile`, and `computeInventoryThrottle`.

- Modify `src/types/config.ts`
  - Adds typed inventory throttle profile config under `InventoryConfig`.

- Modify `src/strategy/config.ts`
  - Adds default `paper` and `small_live` throttle profiles.
  - Keeps existing `softLimitPct`, `reduceOnlyLimitPct`, and `hardLimitPct` for current reports/guards.

- Modify `src/engines/quote-engine.ts`
  - Accepts optional `inventoryThrottle` in `QuoteEngineInputs`.
  - Applies extra widening and size multiplier only to inventory-increasing side.
  - Returns `null` when throttle explicitly blocks that side.

- Modify `src/risk/strategy-risk-manager.ts`
  - Accepts optional mode-specific throttle profiles in `StrategyRiskConfig`.
  - Uses profile `reduceOnlyThresholdPct` when present; falls back to existing `reduceOnlyLimitPct`.

- Modify `src/strategy/strategy-runner.ts`
  - Computes throttle result per side from actual position and config mode.
  - Passes throttle result into `generateQuoteCandidate`.

- Modify `src/run-paper.ts`
  - Passes throttle profiles to `StrategyRiskManager`.
  - Computes throttle result per side from paper PnL position and env mode.
  - Passes throttle result into `generateQuoteCandidate`.

- Test `tests/engines/inventory-throttle.test.ts`
  - Covers profile thresholds and LONG/SHORT/FLAT side semantics.

- Modify `tests/engines/quote-engine.test.ts`
  - Covers quote widening, size reduction, and blocking from throttle.

- Modify `tests/risk/strategy-risk-manager.test.ts`
  - Covers stricter `small_live` reduce-only threshold from throttle profile.

---

## Docker Test Commands

Project policy requires Docker for build/test commands. Use these commands from `/home/alex/Project/MM_Poly`:

```bash
docker compose run --rm app npm run test -- tests/engines/inventory-throttle.test.ts
```

```bash
docker compose run --rm app npm run test -- tests/engines/quote-engine.test.ts
```

```bash
docker compose run --rm app npm run test -- tests/risk/strategy-risk-manager.test.ts
```

```bash
docker compose run --rm app npm run test
```

```bash
docker compose run --rm app npm run build
```

If this repository uses a different Docker service name than `app`, inspect the existing compose file and substitute the correct service name. Do not run bare `npm test` or bare `npm run build`.

---

### Task 1: Add Pure Inventory Throttle Engine

**Files:**
- Create: `src/engines/inventory-throttle.ts`
- Test: `tests/engines/inventory-throttle.test.ts`

- [ ] **Step 1: Write the failing throttle tests**

Create `tests/engines/inventory-throttle.test.ts` with:

```ts
import {
  computeInventoryThrottle,
  getInventoryThrottleProfile,
  InventoryThrottleProfile,
} from '../../src/engines/inventory-throttle';

const paperProfile: InventoryThrottleProfile = {
  reduceOnlyThresholdPct: 50,
  tiers: [
    { startPct: 25, sizeMultiplier: 0.5, extraHalfSpreadCents: 0.5 },
    { startPct: 35, sizeMultiplier: 0.25, extraHalfSpreadCents: 1.5 },
    { startPct: 45, sizeMultiplier: 0.05, extraHalfSpreadCents: 3.0, blockNewInventory: true },
  ],
};

const smallLiveProfile: InventoryThrottleProfile = {
  reduceOnlyThresholdPct: 45,
  tiers: [
    { startPct: 20, sizeMultiplier: 0.5, extraHalfSpreadCents: 0.75 },
    { startPct: 30, sizeMultiplier: 0.2, extraHalfSpreadCents: 2.0 },
    { startPct: 40, sizeMultiplier: 0.05, extraHalfSpreadCents: 4.0, blockNewInventory: true },
  ],
};

const profiles = {
  paper: paperProfile,
  small_live: smallLiveProfile,
};

describe('inventory-throttle', () => {
  test('selects paper profile for paper and shadow modes', () => {
    expect(getInventoryThrottleProfile('paper', profiles)).toBe(paperProfile);
    expect(getInventoryThrottleProfile('shadow', profiles)).toBe(paperProfile);
  });

  test('selects small_live profile for small_live mode', () => {
    expect(getInventoryThrottleProfile('small_live', profiles)).toBe(smallLiveProfile);
  });

  test('returns no throttle below paper first tier', () => {
    const result = computeInventoryThrottle({
      mode: 'paper',
      profiles,
      netPosition: 10,
      inventoryUsagePct: 24.99,
      side: 'BUY',
    });

    expect(result.isInventoryIncreasing).toBe(true);
    expect(result.sizeMultiplier).toBe(1);
    expect(result.extraHalfSpreadCents).toBe(0);
    expect(result.blocked).toBe(false);
    expect(result.reduceOnly).toBe(false);
  });

  test('applies paper tiers at 25, 35, 45, and 50 percent', () => {
    expect(computeInventoryThrottle({ mode: 'paper', profiles, netPosition: 10, inventoryUsagePct: 25, side: 'BUY' })).toMatchObject({
      sizeMultiplier: 0.5,
      extraHalfSpreadCents: 0.5,
      blocked: false,
      reduceOnly: false,
    });
    expect(computeInventoryThrottle({ mode: 'paper', profiles, netPosition: 10, inventoryUsagePct: 35, side: 'BUY' })).toMatchObject({
      sizeMultiplier: 0.25,
      extraHalfSpreadCents: 1.5,
      blocked: false,
      reduceOnly: false,
    });
    expect(computeInventoryThrottle({ mode: 'paper', profiles, netPosition: 10, inventoryUsagePct: 45, side: 'BUY' })).toMatchObject({
      sizeMultiplier: 0.05,
      extraHalfSpreadCents: 3.0,
      blocked: true,
      reduceOnly: false,
    });
    expect(computeInventoryThrottle({ mode: 'paper', profiles, netPosition: 10, inventoryUsagePct: 50, side: 'BUY' })).toMatchObject({
      blocked: true,
      reduceOnly: true,
    });
  });

  test('applies stricter small_live tiers at 20, 30, 40, and 45 percent', () => {
    expect(computeInventoryThrottle({ mode: 'small_live', profiles, netPosition: 10, inventoryUsagePct: 20, side: 'BUY' })).toMatchObject({
      sizeMultiplier: 0.5,
      extraHalfSpreadCents: 0.75,
      blocked: false,
      reduceOnly: false,
    });
    expect(computeInventoryThrottle({ mode: 'small_live', profiles, netPosition: 10, inventoryUsagePct: 30, side: 'BUY' })).toMatchObject({
      sizeMultiplier: 0.2,
      extraHalfSpreadCents: 2.0,
      blocked: false,
      reduceOnly: false,
    });
    expect(computeInventoryThrottle({ mode: 'small_live', profiles, netPosition: 10, inventoryUsagePct: 40, side: 'BUY' })).toMatchObject({
      sizeMultiplier: 0.05,
      extraHalfSpreadCents: 4.0,
      blocked: true,
      reduceOnly: false,
    });
    expect(computeInventoryThrottle({ mode: 'small_live', profiles, netPosition: 10, inventoryUsagePct: 45, side: 'BUY' })).toMatchObject({
      blocked: true,
      reduceOnly: true,
    });
  });

  test('LONG position throttles BUY but not SELL', () => {
    expect(computeInventoryThrottle({ mode: 'paper', profiles, netPosition: 10, inventoryUsagePct: 35, side: 'BUY' })).toMatchObject({
      isInventoryIncreasing: true,
      sizeMultiplier: 0.25,
    });
    expect(computeInventoryThrottle({ mode: 'paper', profiles, netPosition: 10, inventoryUsagePct: 35, side: 'SELL' })).toMatchObject({
      isInventoryIncreasing: false,
      sizeMultiplier: 1,
      extraHalfSpreadCents: 0,
      blocked: false,
      reduceOnly: false,
    });
  });

  test('SHORT position throttles SELL but not BUY', () => {
    expect(computeInventoryThrottle({ mode: 'paper', profiles, netPosition: -10, inventoryUsagePct: 35, side: 'SELL' })).toMatchObject({
      isInventoryIncreasing: true,
      sizeMultiplier: 0.25,
    });
    expect(computeInventoryThrottle({ mode: 'paper', profiles, netPosition: -10, inventoryUsagePct: 35, side: 'BUY' })).toMatchObject({
      isInventoryIncreasing: false,
      sizeMultiplier: 1,
      extraHalfSpreadCents: 0,
      blocked: false,
      reduceOnly: false,
    });
  });

  test('FLAT position does not throttle either side', () => {
    expect(computeInventoryThrottle({ mode: 'paper', profiles, netPosition: 0, inventoryUsagePct: 50, side: 'BUY' })).toMatchObject({
      isInventoryIncreasing: false,
      sizeMultiplier: 1,
      extraHalfSpreadCents: 0,
      blocked: false,
      reduceOnly: false,
    });
    expect(computeInventoryThrottle({ mode: 'paper', profiles, netPosition: 0, inventoryUsagePct: 50, side: 'SELL' })).toMatchObject({
      isInventoryIncreasing: false,
      sizeMultiplier: 1,
      extraHalfSpreadCents: 0,
      blocked: false,
      reduceOnly: false,
    });
  });
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```bash
docker compose run --rm app npm run test -- tests/engines/inventory-throttle.test.ts
```

Expected: FAIL because `../../src/engines/inventory-throttle` does not exist.

- [ ] **Step 3: Add the pure throttle implementation**

Create `src/engines/inventory-throttle.ts` with:

```ts
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
```

- [ ] **Step 4: Run the new test and verify it passes**

Run:

```bash
docker compose run --rm app npm run test -- tests/engines/inventory-throttle.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add src/engines/inventory-throttle.ts tests/engines/inventory-throttle.test.ts
git commit -m "feat(risk): add inventory throttle engine"
```

---

### Task 2: Add Typed Throttle Profiles to Config

**Files:**
- Modify: `src/types/config.ts:45-54`
- Modify: `src/strategy/config.ts:30-35`
- Test: `tests/engines/inventory-throttle.test.ts`

- [ ] **Step 1: Write failing config-profile test**

Append this test inside the existing `describe('inventory-throttle', () => { ... })` block in `tests/engines/inventory-throttle.test.ts`:

```ts
  test('default config exposes paper and small_live throttle profiles', () => {
    const { defaultConfig } = require('../../src/strategy/config');

    expect(defaultConfig.inventory.throttleProfiles.paper.reduceOnlyThresholdPct).toBe(50);
    expect(defaultConfig.inventory.throttleProfiles.paper.tiers).toEqual([
      { startPct: 25, sizeMultiplier: 0.5, extraHalfSpreadCents: 0.5 },
      { startPct: 35, sizeMultiplier: 0.25, extraHalfSpreadCents: 1.5 },
      { startPct: 45, sizeMultiplier: 0.05, extraHalfSpreadCents: 3.0, blockNewInventory: true },
    ]);

    expect(defaultConfig.inventory.throttleProfiles.small_live.reduceOnlyThresholdPct).toBe(45);
    expect(defaultConfig.inventory.throttleProfiles.small_live.tiers).toEqual([
      { startPct: 20, sizeMultiplier: 0.5, extraHalfSpreadCents: 0.75 },
      { startPct: 30, sizeMultiplier: 0.2, extraHalfSpreadCents: 2.0 },
      { startPct: 40, sizeMultiplier: 0.05, extraHalfSpreadCents: 4.0, blockNewInventory: true },
    ]);
  });
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
docker compose run --rm app npm run test -- tests/engines/inventory-throttle.test.ts
```

Expected: FAIL because `defaultConfig.inventory.throttleProfiles` is undefined or `InventoryConfig` lacks that property.

- [ ] **Step 3: Add config types**

Modify `src/types/config.ts` to import the profile type at the top:

```ts
import { InventoryThrottleProfiles } from '../engines/inventory-throttle';
```

Then change `InventoryConfig` to:

```ts
export interface InventoryConfig {
  maxMarketExposureUsd: number;
  maxEventExposureUsd: number;
  maxTotalStrategyExposureUsd: number;
  softLimitPct: number;
  reduceOnlyLimitPct: number;
  hardLimitPct: number;
  maxSkewCents: number;
  skewSensitivity: number;
  throttleProfiles: InventoryThrottleProfiles;
}
```

- [ ] **Step 4: Add default profile values**

Modify the `inventory` object in `src/strategy/config.ts` to:

```ts
  inventory: {
    maxMarketExposureUsd: 10, maxEventExposureUsd: 25,
    maxTotalStrategyExposureUsd: 100,
    softLimitPct: 25, reduceOnlyLimitPct: 50, hardLimitPct: 75,
    maxSkewCents: 4.5, skewSensitivity: 0.70,
    throttleProfiles: {
      paper: {
        reduceOnlyThresholdPct: 50,
        tiers: [
          { startPct: 25, sizeMultiplier: 0.5, extraHalfSpreadCents: 0.5 },
          { startPct: 35, sizeMultiplier: 0.25, extraHalfSpreadCents: 1.5 },
          { startPct: 45, sizeMultiplier: 0.05, extraHalfSpreadCents: 3.0, blockNewInventory: true },
        ],
      },
      small_live: {
        reduceOnlyThresholdPct: 45,
        tiers: [
          { startPct: 20, sizeMultiplier: 0.5, extraHalfSpreadCents: 0.75 },
          { startPct: 30, sizeMultiplier: 0.2, extraHalfSpreadCents: 2.0 },
          { startPct: 40, sizeMultiplier: 0.05, extraHalfSpreadCents: 4.0, blockNewInventory: true },
        ],
      },
    }
  },
```

- [ ] **Step 5: Run throttle tests**

Run:

```bash
docker compose run --rm app npm run test -- tests/engines/inventory-throttle.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run build**

Run:

```bash
docker compose run --rm app npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

Run:

```bash
git add src/types/config.ts src/strategy/config.ts tests/engines/inventory-throttle.test.ts
git commit -m "feat(config): add inventory throttle profiles"
```

---

### Task 3: Apply Throttle in Quote Generation

**Files:**
- Modify: `src/engines/quote-engine.ts:1-247`
- Test: `tests/engines/quote-engine.test.ts`

- [ ] **Step 1: Add failing quote-engine tests**

Append these tests inside `describe('quote-engine', () => { ... })` in `tests/engines/quote-engine.test.ts`:

```ts
  test('applies inventory throttle extra widening to quote price', () => {
    const withoutThrottle = generateQuoteCandidate({
      conditionId: 'cond1', tokenId: 'yes1', side: 'BUY',
      fairPrice: 0.50, book: baseBook,
      spread: { baseHalfSpreadCents: 1.0, minHalfSpreadTicks: 1, adverseSelectionBufferCents: 0, toxicityWideningMaxCents: 0, inventoryWideningMaxCents: 0, volatilityMultiplier: 1, rewardTighteningMaxCents: 1 },
      size: { baseOrderSizeUsd: 10, maxOrderSizeUsd: 100, minSizeMultiplierOverExchangeMin: 1, respectRewardMinIncentiveSize: false },
      toxicityScore: 0.1, inventoryPct: 0, inventorySkewCents: 0,
    });

    const withThrottle = generateQuoteCandidate({
      conditionId: 'cond1', tokenId: 'yes1', side: 'BUY',
      fairPrice: 0.50, book: baseBook,
      spread: { baseHalfSpreadCents: 1.0, minHalfSpreadTicks: 1, adverseSelectionBufferCents: 0, toxicityWideningMaxCents: 0, inventoryWideningMaxCents: 0, volatilityMultiplier: 1, rewardTighteningMaxCents: 1 },
      size: { baseOrderSizeUsd: 10, maxOrderSizeUsd: 100, minSizeMultiplierOverExchangeMin: 1, respectRewardMinIncentiveSize: false },
      toxicityScore: 0.1, inventoryPct: 0, inventorySkewCents: 0,
      inventoryThrottle: {
        isInventoryIncreasing: true,
        sizeMultiplier: 1,
        extraHalfSpreadCents: 2,
        blocked: false,
        reduceOnly: false,
      },
    });

    expect(withThrottle!.targetHalfSpreadCents).toBe(withoutThrottle!.targetHalfSpreadCents + 2);
    expect(withThrottle!.candidate.price).toBeLessThan(withoutThrottle!.candidate.price);
  });

  test('applies inventory throttle size multiplier', () => {
    const result = generateQuoteCandidate({
      conditionId: 'cond1', tokenId: 'yes1', side: 'BUY',
      fairPrice: 0.50, book: baseBook,
      spread: { baseHalfSpreadCents: 1.0, minHalfSpreadTicks: 1, adverseSelectionBufferCents: 0, toxicityWideningMaxCents: 0, inventoryWideningMaxCents: 0, volatilityMultiplier: 1, rewardTighteningMaxCents: 1 },
      size: { baseOrderSizeUsd: 10, maxOrderSizeUsd: 100, minSizeMultiplierOverExchangeMin: 1, respectRewardMinIncentiveSize: false },
      toxicityScore: 0.1, inventoryPct: 0, inventorySkewCents: 0,
      inventoryThrottle: {
        isInventoryIncreasing: true,
        sizeMultiplier: 0.5,
        extraHalfSpreadCents: 0,
        blocked: false,
        reduceOnly: false,
      },
    });

    expect(result!.candidate.sizeUsd).toBeGreaterThanOrEqual(4.5);
    expect(result!.candidate.sizeUsd).toBeLessThan(6);
  });

  test('returns null when inventory throttle blocks the side', () => {
    const result = generateQuoteCandidate({
      conditionId: 'cond1', tokenId: 'yes1', side: 'BUY',
      fairPrice: 0.50, book: baseBook,
      spread: { baseHalfSpreadCents: 1.0, minHalfSpreadTicks: 1, adverseSelectionBufferCents: 0, toxicityWideningMaxCents: 0, inventoryWideningMaxCents: 0, volatilityMultiplier: 1, rewardTighteningMaxCents: 1 },
      size: { baseOrderSizeUsd: 10, maxOrderSizeUsd: 100, minSizeMultiplierOverExchangeMin: 1, respectRewardMinIncentiveSize: false },
      toxicityScore: 0.1, inventoryPct: 0, inventorySkewCents: 0,
      inventoryThrottle: {
        isInventoryIncreasing: true,
        sizeMultiplier: 0.05,
        extraHalfSpreadCents: 3,
        blocked: true,
        reduceOnly: false,
      },
    });

    expect(result).toBeNull();
  });
```

- [ ] **Step 2: Run quote-engine tests and verify they fail**

Run:

```bash
docker compose run --rm app npm run test -- tests/engines/quote-engine.test.ts
```

Expected: FAIL because `inventoryThrottle` is not part of `QuoteEngineInputs` and no throttle is applied.

- [ ] **Step 3: Import throttle type**

Modify imports at the top of `src/engines/quote-engine.ts` to include:

```ts
import { InventoryThrottleResult } from './inventory-throttle';
```

- [ ] **Step 4: Add optional throttle input**

Add this field to `QuoteEngineInputs`:

```ts
  inventoryThrottle?: InventoryThrottleResult;
```

- [ ] **Step 5: Add size multiplier argument**

Change `computeQuoteSize` signature to include a final parameter:

```ts
  rewardConfig?: RewardConfig | null,
  inventoryThrottleSizeMultiplier = 1
): number {
```

After the existing inventory size multiplier block and before the depth multiplier block, add:

```ts
  sizeUsd *= inventoryThrottleSizeMultiplier;
```

- [ ] **Step 6: Apply block and widening in `generateQuoteCandidate`**

In `generateQuoteCandidate`, destructure `inventoryThrottle`:

```ts
    rewardConfig, isBookStale, inventoryThrottle
```

After the book safety guards, add:

```ts
  if (inventoryThrottle?.blocked) return null;
```

Change half-spread computation from:

```ts
  const halfSpreadCents = inputs.targetHalfSpreadCentsOverride ??
    computeTargetHalfSpread(spread, toxicityScore, inventoryPct, book, rewardConfig);
```

to:

```ts
  const baseHalfSpreadCents = inputs.targetHalfSpreadCentsOverride ??
    computeTargetHalfSpread(spread, toxicityScore, inventoryPct, book, rewardConfig);
  const halfSpreadCents = baseHalfSpreadCents + (inventoryThrottle?.extraHalfSpreadCents ?? 0);
```

Change the size call from:

```ts
  const tokenSize = computeQuoteSize(size, price, book, toxicityScore, inventoryPct, inventoryAction, side, rewardConfig);
```

to:

```ts
  const tokenSize = computeQuoteSize(
    size,
    price,
    book,
    toxicityScore,
    inventoryPct,
    inventoryAction,
    side,
    rewardConfig,
    inventoryThrottle?.sizeMultiplier ?? 1
  );
```

- [ ] **Step 7: Run quote-engine tests**

Run:

```bash
docker compose run --rm app npm run test -- tests/engines/quote-engine.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

Run:

```bash
git add src/engines/quote-engine.ts tests/engines/quote-engine.test.ts
git commit -m "feat(quote): apply inventory throttle adjustments"
```

---

### Task 4: Use Profile Reduce-Only Thresholds in Risk Manager

**Files:**
- Modify: `src/risk/strategy-risk-manager.ts:1-208`
- Test: `tests/risk/strategy-risk-manager.test.ts`

- [ ] **Step 1: Add failing risk-manager test**

Append this test inside `describe('StrategyRiskManager', () => { ... })` in `tests/risk/strategy-risk-manager.test.ts`:

```ts
  test('uses small_live throttle profile reduce-only threshold when configured', () => {
    const manager = new StrategyRiskManager({
      ...config,
      reduceOnlyLimitPct: 70,
      throttleProfiles: {
        paper: {
          reduceOnlyThresholdPct: 50,
          tiers: [],
        },
        small_live: {
          reduceOnlyThresholdPct: 45,
          tiers: [],
        },
      },
    });

    const decision = manager.evaluateMarket({
      mode: 'small_live',
      conditionId: 'market-1',
      tokenId: 'token-yes',
      position: makePosition({ netSize: 50, avgCost: 0.40 }),
      book: makeBook(),
      currentFair: 0.45,
      primaryMarketQuoteSharePct: 50,
      hasActiveQuotes: true,
      isBookStale: false,
      killSwitchActive: false,
    });

    expect(decision.inventoryUsagePct).toBeCloseTo(45);
    expect(decision.reduceOnly).toBe(true);
    expect(decision.allowBuy).toBe(false);
    expect(decision.allowSell).toBe(true);
    expect(decision.riskStatus).toBe('WARNING');
    expect(decision.reasons).toContain('reduce_only_long_inventory');
  });
```

- [ ] **Step 2: Run risk-manager tests and verify they fail**

Run:

```bash
docker compose run --rm app npm run test -- tests/risk/strategy-risk-manager.test.ts
```

Expected: FAIL because `StrategyRiskConfig` does not accept `throttleProfiles` and still uses only `reduceOnlyLimitPct`.

- [ ] **Step 3: Import throttle profile helpers**

Modify imports in `src/risk/strategy-risk-manager.ts`:

```ts
import { InventoryThrottleProfiles, getInventoryThrottleProfile } from '../engines/inventory-throttle';
```

- [ ] **Step 4: Add optional profiles to risk config**

Change `StrategyRiskConfig` to:

```ts
export interface StrategyRiskConfig {
  softInventoryLimitPct: number;
  reduceOnlyLimitPct: number;
  hardInventoryLimitPct: number;
  maxMarketExposureUsd: number;
  concentrationWarningPct: number;
  concentrationCriticalPctLive: number;
  throttleProfiles?: InventoryThrottleProfiles;
}
```

- [ ] **Step 5: Add reduce-only threshold helper**

Inside `StrategyRiskManager`, before `evaluateMarket`, add:

```ts
  private getReduceOnlyLimitPct(mode: StrategyMode): number {
    if (!this.config.throttleProfiles) return this.config.reduceOnlyLimitPct;
    return getInventoryThrottleProfile(mode, this.config.throttleProfiles).reduceOnlyThresholdPct;
  }
```

- [ ] **Step 6: Use helper in decisions and status**

At the top of `evaluateMarket`, after `inventoryUsagePct`, add:

```ts
    const reduceOnlyLimitPct = this.getReduceOnlyLimitPct(input.mode);
```

Change:

```ts
    if (inventoryUsagePct !== null && inventoryUsagePct >= this.config.reduceOnlyLimitPct) {
```

to:

```ts
    if (inventoryUsagePct !== null && inventoryUsagePct >= reduceOnlyLimitPct) {
```

Change the return field:

```ts
      riskStatus: this.computeRiskStatus(reasons, inventoryUsagePct),
```

to:

```ts
      riskStatus: this.computeRiskStatus(reasons, inventoryUsagePct, reduceOnlyLimitPct),
```

Change `computeRiskStatus` signature:

```ts
  private computeRiskStatus(reasons: string[], inventoryUsagePct: number | null, reduceOnlyLimitPct: number): RiskStatus {
```

Change inside `computeRiskStatus`:

```ts
    if (inventoryUsagePct !== null && inventoryUsagePct >= this.config.reduceOnlyLimitPct) {
```

to:

```ts
    if (inventoryUsagePct !== null && inventoryUsagePct >= reduceOnlyLimitPct) {
```

- [ ] **Step 7: Run risk-manager tests**

Run:

```bash
docker compose run --rm app npm run test -- tests/risk/strategy-risk-manager.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 4**

Run:

```bash
git add src/risk/strategy-risk-manager.ts tests/risk/strategy-risk-manager.test.ts
git commit -m "feat(risk): use throttle reduce-only thresholds"
```

---

### Task 5: Wire Throttle Through Runtime Quoting

**Files:**
- Modify: `src/strategy/strategy-runner.ts:1-360`
- Modify: `src/run-paper.ts:72-79` and `src/run-paper.ts:248-273`

- [ ] **Step 1: Update `strategy-runner` imports**

In `src/strategy/strategy-runner.ts`, add:

```ts
import { computeInventoryThrottle } from '../engines/inventory-throttle';
```

- [ ] **Step 2: Pass profiles to `StrategyRiskManager` in `run-paper`**

Modify the risk manager config in `src/run-paper.ts`:

```ts
  const riskManager = new StrategyRiskManager({
    softInventoryLimitPct: config.inventory.softLimitPct,
    reduceOnlyLimitPct: config.inventory.reduceOnlyLimitPct,
    hardInventoryLimitPct: config.inventory.hardLimitPct,
    maxMarketExposureUsd: config.inventory.maxMarketExposureUsd,
    concentrationWarningPct: 90,
    concentrationCriticalPctLive: 90,
    throttleProfiles: config.inventory.throttleProfiles,
  });
```

- [ ] **Step 3: Update `run-paper` imports**

In `src/run-paper.ts`, add:

```ts
import { computeInventoryThrottle } from './engines/inventory-throttle';
```

- [ ] **Step 4: Wire throttle in `strategy-runner` quote loop**

In `src/strategy/strategy-runner.ts`, immediately before `generateQuoteCandidate({` add:

```ts
      const inventoryThrottle = computeInventoryThrottle({
        mode: config.mode,
        profiles: config.inventory.throttleProfiles,
        netPosition: invState.netPosition,
        inventoryUsagePct: Math.abs(invState.inventoryPct),
        side,
      });
```

Then add this property to the `generateQuoteCandidate` input:

```ts
        inventoryThrottle,
```

- [ ] **Step 5: Wire throttle in `run-paper` quote loop**

In `src/run-paper.ts`, immediately before `generateQuoteCandidate({` add:

```ts
      const inventoryThrottle = computeInventoryThrottle({
        mode: env.mode,
        profiles: config.inventory.throttleProfiles,
        netPosition: pos?.netSize ?? 0,
        inventoryUsagePct: inventoryPct,
        side,
      });
```

Then add this property to the `generateQuoteCandidate` input:

```ts
        inventoryThrottle,
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
docker compose run --rm app npm run test -- tests/engines/inventory-throttle.test.ts tests/engines/quote-engine.test.ts tests/risk/strategy-risk-manager.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run build**

Run:

```bash
docker compose run --rm app npm run build
```

Expected: PASS.

- [ ] **Step 8: Commit Task 5**

Run:

```bash
git add src/strategy/strategy-runner.ts src/run-paper.ts
git commit -m "feat(strategy): wire inventory throttle into quoting"
```

---

### Task 6: Final Verification

**Files:**
- No code changes expected.

- [ ] **Step 1: Run full Docker test suite**

Run:

```bash
docker compose run --rm app npm run test
```

Expected: PASS.

- [ ] **Step 2: Run Docker build**

Run:

```bash
docker compose run --rm app npm run build
```

Expected: PASS.

- [ ] **Step 3: Inspect git status**

Run:

```bash
git status --short
```

Expected: only intentional committed changes should be absent from working tree. If the plan/spec files are still uncommitted, commit them.

- [ ] **Step 4: Commit plan/spec if not already committed**

If `git status --short` shows `docs/superpowers/specs/2026-05-22-inventory-throttle-profiles-design.md` or `docs/superpowers/plans/2026-05-22-inventory-throttle-profiles.md`, run:

```bash
git add docs/superpowers/specs/2026-05-22-inventory-throttle-profiles-design.md docs/superpowers/plans/2026-05-22-inventory-throttle-profiles.md
git commit -m "docs: add inventory throttle implementation plan"
```

---

## Self-Review

Spec coverage:

- Separate `paper` and `small_live` profiles: Task 2.
- Side-aware LONG/SHORT/FLAT behavior: Task 1.
- Size multiplier and extra widening: Task 3.
- Near-block and reduce-only behavior: Tasks 1, 3, and 4.
- Runtime profile selection by mode: Tasks 4 and 5.
- Tests for profile and side behavior: Tasks 1, 3, and 4.
- Docker verification: Tasks 1-6.

Placeholder scan: no TBD/TODO/fill-in-later placeholders are present. The only conditional instruction is Docker service-name substitution if the repository's compose service is not `app`; this is necessary because the exact compose service was not inspected in this planning step.

Type consistency: `InventoryThrottleProfiles`, `InventoryThrottleProfile`, `InventoryThrottleResult`, `computeInventoryThrottle`, and `getInventoryThrottleProfile` are introduced in Task 1 and used consistently in later tasks.
