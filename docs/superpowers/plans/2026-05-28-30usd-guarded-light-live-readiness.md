# $30 Guarded Light-Live Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a conservative `$30` small-live readiness profile, stricter executable-exit guards, conservative paper fills, and paper-soak go/no-go reporting before 2026-06-01.

**Architecture:** Keep changes inside existing pure/risk/simulation boundaries. Configuration owns small-live sizing and thresholds; `StrategyRiskManager` owns market-level quote permissions; `PaperExecutionEngine` owns conservative fill assumptions; Telegram/report integration exposes go/no-go evidence without starting live trading.

**Tech Stack:** TypeScript, Jest, Docker Compose (`docker compose run --rm polymarket-bot ...`), existing risk manager, existing paper runner, existing Telegram report formatter.

---

## File Structure

Modify existing files only unless a task explicitly says otherwise:

- `src/types/config.ts`
  - Add absolute drawdown and conservative paper-fill config fields.
- `src/strategy/config.ts`
  - Set `$30`-safe `small_live` limits and conservative paper-fill defaults.
- `src/risk/kill-switch.ts`
  - Support absolute drawdown dollars in addition to percentage drawdown.
- `src/risk/strategy-risk-manager.ts`
  - Make `small_live` block inventory-increasing quotes for any negative executable exit and use stricter critical thresholds.
- `src/simulation/paper-execution-engine.ts`
  - Add a conservative fill model that requires trade volume to clear a queue buffer before filling paper orders.
- `src/run-paper.ts`
  - Pass conservative paper-fill config into the engine and pass `$30`-safe risk thresholds into `StrategyRiskManager`.
- `src/reporting/telegram-risk-report.ts`
  - Make go/no-go action text mention paper-soak blockers.
- Tests:
  - `tests/engines/inventory-throttle.test.ts`
  - `tests/risk/kill-switch.test.ts`
  - `tests/risk/strategy-risk-manager.test.ts`
  - `tests/simulation/paper-execution-engine.test.ts`
  - `tests/integration/risk-gated-paper-report.test.ts`

Do not modify live order placement behavior beyond risk/config gating in this plan.

---

## Task 1: Add `$30` small-live config limits

**Files:**
- Modify: `src/strategy/config.ts:25-52`
- Test: `tests/engines/inventory-throttle.test.ts`

- [ ] **Step 1: Write the failing config test**

Replace the `default config exposes paper and small_live throttle profiles` test in `tests/engines/inventory-throttle.test.ts` with:

```ts
test('default config exposes $30 guarded small_live sizing and throttle profile', () => {
  expect(defaultConfig.size.baseOrderSizeUsd).toBe(1);
  expect(defaultConfig.size.maxOrderSizeUsd).toBe(1.5);

  expect(defaultConfig.inventory.maxMarketExposureUsd).toBe(3);
  expect(defaultConfig.inventory.maxEventExposureUsd).toBe(10);
  expect(defaultConfig.inventory.maxTotalStrategyExposureUsd).toBe(25);

  expect(defaultConfig.inventory.throttleProfiles.paper.reduceOnlyThresholdPct).toBe(50);
  expect(defaultConfig.inventory.throttleProfiles.paper.tiers).toEqual([
    { startPct: 25, sizeMultiplier: 0.5, extraHalfSpreadCents: 0.5 },
    { startPct: 35, sizeMultiplier: 0.25, extraHalfSpreadCents: 1.5 },
    { startPct: 45, sizeMultiplier: 0.05, extraHalfSpreadCents: 3.0, blockNewInventory: true },
  ]);

  expect(defaultConfig.inventory.throttleProfiles.small_live.reduceOnlyThresholdPct).toBe(35);
  expect(defaultConfig.inventory.throttleProfiles.small_live.tiers).toEqual([
    { startPct: 15, sizeMultiplier: 0.5, extraHalfSpreadCents: 0.75 },
    { startPct: 25, sizeMultiplier: 0.2, extraHalfSpreadCents: 2.0 },
    { startPct: 35, sizeMultiplier: 0.05, extraHalfSpreadCents: 4.0, blockNewInventory: true },
  ]);
});
```

- [ ] **Step 2: Update the local test profile constants**

In the same test file, replace `smallLiveProfile` with:

```ts
const smallLiveProfile: InventoryThrottleProfile = {
  reduceOnlyThresholdPct: 35,
  tiers: [
    { startPct: 15, sizeMultiplier: 0.5, extraHalfSpreadCents: 0.75 },
    { startPct: 25, sizeMultiplier: 0.2, extraHalfSpreadCents: 2.0 },
    { startPct: 35, sizeMultiplier: 0.05, extraHalfSpreadCents: 4.0, blockNewInventory: true },
  ],
};
```

Replace the test name `applies stricter small_live tiers at 20, 30, 40, and 45 percent` and body with:

```ts
test('applies stricter small_live tiers at 15, 25, and 35 percent', () => {
  expect(computeInventoryThrottle({ mode: 'small_live', profiles, netPosition: 10, inventoryUsagePct: 15, side: 'BUY' })).toMatchObject({
    sizeMultiplier: 0.5,
    extraHalfSpreadCents: 0.75,
    blocked: false,
    reduceOnly: false,
  });
  expect(computeInventoryThrottle({ mode: 'small_live', profiles, netPosition: 10, inventoryUsagePct: 25, side: 'BUY' })).toMatchObject({
    sizeMultiplier: 0.2,
    extraHalfSpreadCents: 2.0,
    blocked: false,
    reduceOnly: false,
  });
  expect(computeInventoryThrottle({ mode: 'small_live', profiles, netPosition: 10, inventoryUsagePct: 35, side: 'BUY' })).toMatchObject({
    sizeMultiplier: 0.05,
    extraHalfSpreadCents: 4.0,
    blocked: true,
    reduceOnly: true,
  });
});
```

- [ ] **Step 3: Run the focused test and verify it fails**

Run:

```bash
docker compose run --rm polymarket-bot npm test -- tests/engines/inventory-throttle.test.ts --runInBand
```

Expected: FAIL because config still uses `$10/$25/$100`, max order `$2.5`, and small-live tiers `20/30/40/45`.

- [ ] **Step 4: Implement the config change**

In `src/strategy/config.ts`, change the `size` and `inventory` blocks to:

```ts
  size: {
    baseOrderSizeUsd: 1, maxOrderSizeUsd: 1.5,
    minSizeMultiplierOverExchangeMin: 1.2,
    respectRewardMinIncentiveSize: true
  },
  inventory: {
    maxMarketExposureUsd: 3, maxEventExposureUsd: 10,
    maxTotalStrategyExposureUsd: 25,
    softLimitPct: 15, reduceOnlyLimitPct: 35, hardLimitPct: 50,
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
        reduceOnlyThresholdPct: 35,
        tiers: [
          { startPct: 15, sizeMultiplier: 0.5, extraHalfSpreadCents: 0.75 },
          { startPct: 25, sizeMultiplier: 0.2, extraHalfSpreadCents: 2.0 },
          { startPct: 35, sizeMultiplier: 0.05, extraHalfSpreadCents: 4.0, blockNewInventory: true },
        ],
      },
    }
  },
```

- [ ] **Step 5: Run the focused test and verify it passes**

Run:

```bash
docker compose run --rm polymarket-bot npm test -- tests/engines/inventory-throttle.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/strategy/config.ts tests/engines/inventory-throttle.test.ts
git commit -m "fix(risk): tighten small-live limits for $30 bankroll"
```

---

## Task 2: Add absolute `$5` kill-switch drawdown

**Files:**
- Modify: `src/types/config.ts:68-76`
- Modify: `src/strategy/config.ts:62-69`
- Modify: `src/risk/kill-switch.ts:15-58`
- Test: `tests/risk/kill-switch.test.ts`

- [ ] **Step 1: Write the failing kill-switch test**

Append to `tests/risk/kill-switch.test.ts`:

```ts
test('disables strategy at absolute drawdown limit', () => {
  const ks = new KillSwitch({ maxDailyDrawdownUsd: 5 });

  expect(
    ks.check(
      { connected: true, disconnectedAt: null },
      { errorsLast60s: 0, totalLast60s: 100 },
      { currentDrawdownPct: 0, currentDrawdownUsd: 5 }
    )
  ).toBe('DISABLE_STRATEGY');
});
```

- [ ] **Step 2: Run the focused test and verify it fails to compile**

Run:

```bash
docker compose run --rm polymarket-bot npm test -- tests/risk/kill-switch.test.ts --runInBand
```

Expected: FAIL because `maxDailyDrawdownUsd` and `currentDrawdownUsd` do not exist.

- [ ] **Step 3: Add config and drawdown types**

In `src/types/config.ts`, update `RiskConfig` to:

```ts
export interface RiskConfig {
  maxDailyDrawdownPct: number;
  maxDailyDrawdownUsd: number;
  maxStrategyDrawdownPct: number;
  maxConsecutiveAdverseFills: number;
  cancelAllOnWsDisconnectSeconds: number;
  cancelAllOnApiErrorRatePct: number;
  cancelAllOnTickSizeChange: boolean;
  disableNearResolutionMinutes: number;
}
```

In `src/risk/kill-switch.ts`, update `Drawdown` to:

```ts
export interface Drawdown {
  currentDrawdownPct: number;
  currentDrawdownUsd?: number;
}
```

- [ ] **Step 4: Implement absolute drawdown check**

In `src/risk/kill-switch.ts`, after the percentage drawdown block, add:

```ts
    if (this.config.maxDailyDrawdownUsd != null &&
        drawdown.currentDrawdownUsd != null &&
        drawdown.currentDrawdownUsd >= this.config.maxDailyDrawdownUsd) {
      return 'DISABLE_STRATEGY';
    }
```

- [ ] **Step 5: Configure `$5` default limit**

In `src/strategy/config.ts`, update the `risk` block first line to:

```ts
    maxDailyDrawdownPct: 2, maxDailyDrawdownUsd: 5, maxStrategyDrawdownPct: 5,
```

- [ ] **Step 6: Run the focused test and verify it passes**

Run:

```bash
docker compose run --rm polymarket-bot npm test -- tests/risk/kill-switch.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/types/config.ts src/strategy/config.ts src/risk/kill-switch.ts tests/risk/kill-switch.test.ts
git commit -m "feat(risk): add absolute live drawdown kill switch"
```

---

## Task 3: Make negative executable exit a hard small-live inventory guard

**Files:**
- Modify: `src/risk/strategy-risk-manager.ts:160-193`
- Test: `tests/risk/strategy-risk-manager.test.ts`

- [ ] **Step 1: Write tests for small-live negative exit blocking**

Append to `tests/risk/strategy-risk-manager.test.ts`:

```ts
test('small_live blocks inventory-increasing BUY for long position on any negative executable exit', () => {
  const manager = new StrategyRiskManager({
    ...config,
    negativeExitWarningUsd: 0,
    negativeExitCriticalUsd: -0.15,
  });

  const decision = manager.evaluateMarket({
    mode: 'small_live',
    conditionId: 'market-1',
    tokenId: 'token-yes',
    position: makePosition({ netSize: 2, avgCost: 0.58 }),
    book: makeBook({ bestBid: 0.55, bestAsk: 0.56 }),
    currentFair: 0.57,
    primaryMarketQuoteSharePct: 10,
    hasActiveQuotes: true,
    isBookStale: false,
    killSwitchActive: false,
  });

  expect(decision.exitPnlAtBestBidAsk).toBeCloseTo(-0.06);
  expect(decision.reasons).toContain('negative_executable_exit');
  expect(decision.allowBuy).toBe(false);
  expect(decision.allowSell).toBe(true);
  expect(decision.riskStatus).toBe('WARNING');
});

test('small_live escalates severe negative executable exit at fifteen cents', () => {
  const manager = new StrategyRiskManager({
    ...config,
    negativeExitWarningUsd: 0,
    negativeExitCriticalUsd: -0.15,
  });

  const decision = manager.evaluateMarket({
    mode: 'small_live',
    conditionId: 'market-1',
    tokenId: 'token-yes',
    position: makePosition({ netSize: -2, avgCost: 0.55 }),
    book: makeBook({ bestBid: 0.61, bestAsk: 0.64 }),
    currentFair: 0.60,
    primaryMarketQuoteSharePct: 10,
    hasActiveQuotes: true,
    isBookStale: false,
    killSwitchActive: false,
  });

  expect(decision.exitPnlAtBestBidAsk).toBeCloseTo(-0.18);
  expect(decision.reasons).toContain('severe_negative_executable_exit');
  expect(decision.allowSell).toBe(false);
  expect(decision.allowBuy).toBe(true);
  expect(decision.reduceOnly).toBe(true);
  expect(decision.riskStatus).toBe('CRITICAL');
});
```

- [ ] **Step 2: Run the focused test and verify the first test fails**

Run:

```bash
docker compose run --rm polymarket-bot npm test -- tests/risk/strategy-risk-manager.test.ts --runInBand
```

Expected: FAIL because non-severe negative exit currently throttles but does not block the inventory-increasing side.

- [ ] **Step 3: Implement small-live hard block**

In `src/risk/strategy-risk-manager.ts`, after the `negative_executable_exit` reason is pushed, add:

```ts
      if (input.mode === 'small_live') {
        if (netPosition < 0) {
          allowSell = false;
        } else if (netPosition > 0) {
          allowBuy = false;
        }
      }
```

The block should be inside:

```ts
if (hasOpenPosition && exitPnlAtBestBidAsk !== null && exitPnlAtBestBidAsk < negativeExitWarningUsd) {
  reasons.push('negative_executable_exit');
  // new small_live block here
}
```

- [ ] **Step 4: Wire stricter thresholds from paper runner**

In `src/run-paper.ts`, find the `new StrategyRiskManager({ ... })` call and ensure it includes:

```ts
    negativeExitWarningUsd: 0,
    negativeExitCriticalUsd: -0.15,
```

Keep existing `maxBookSpreadCents`, inventory, and concentration fields unchanged except for values already derived from config.

- [ ] **Step 5: Run focused risk tests and verify they pass**

Run:

```bash
docker compose run --rm polymarket-bot npm test -- tests/risk/strategy-risk-manager.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/risk/strategy-risk-manager.ts src/run-paper.ts tests/risk/strategy-risk-manager.test.ts
git commit -m "fix(risk): block negative-exit inventory growth in small live"
```

---

## Task 4: Add conservative paper fill model

**Files:**
- Modify: `src/types/config.ts`
- Modify: `src/strategy/config.ts`
- Modify: `src/simulation/paper-execution-engine.ts`
- Modify: `src/run-paper.ts`
- Test: `tests/simulation/paper-execution-engine.test.ts`

- [ ] **Step 1: Write failing conservative-fill tests**

Append to `tests/simulation/paper-execution-engine.test.ts`:

```ts
test('conservative mode requires trade volume to clear queue before filling', () => {
  const engine = new PaperExecutionEngine({ queueAheadSize: 5, fillFractionAfterQueue: 0.5 });
  engine.submit({ id: 'o-conservative', tokenId: 'yes1', side: 'BUY', price: 0.48, size: 10, sizeUsd: 4.8, postOnly: true });

  expect(engine.onTrade({ tokenId: 'yes1', price: 0.48, size: 3 })).toHaveLength(0);

  const fills = engine.onTrade({ tokenId: 'yes1', price: 0.48, size: 5 });

  expect(fills).toHaveLength(1);
  expect(fills[0].filledSize).toBe(1.5);
  expect(fills[0].remainingSize).toBe(8.5);
});

test('default mode preserves existing crossing-fill behavior', () => {
  const engine = new PaperExecutionEngine();
  engine.submit({ id: 'o-default', tokenId: 'yes1', side: 'BUY', price: 0.48, size: 10, sizeUsd: 4.8, postOnly: true });

  const fills = engine.onTrade({ tokenId: 'yes1', price: 0.48, size: 3 });

  expect(fills).toHaveLength(1);
  expect(fills[0].filledSize).toBe(3);
  expect(fills[0].remainingSize).toBe(7);
});
```

- [ ] **Step 2: Run focused simulation test and verify it fails**

Run:

```bash
docker compose run --rm polymarket-bot npm test -- tests/simulation/paper-execution-engine.test.ts --runInBand
```

Expected: FAIL because `PaperExecutionEngine` does not accept conservative fill config.

- [ ] **Step 3: Add config type**

In `src/types/config.ts`, add after `RiskConfig`:

```ts
export interface PaperExecutionConfig {
  queueAheadSize: number;
  fillFractionAfterQueue: number;
}
```

Add this property to `StrategyConfig`:

```ts
  paperExecution: PaperExecutionConfig;
```

- [ ] **Step 4: Add default conservative paper config**

In `src/strategy/config.ts`, add before `refreshIntervalMs`:

```ts
  paperExecution: {
    queueAheadSize: 5,
    fillFractionAfterQueue: 0.5,
  },
```

- [ ] **Step 5: Implement conservative fill state**

In `src/simulation/paper-execution-engine.ts`, add near the interfaces:

```ts
export interface PaperExecutionConfig {
  queueAheadSize: number;
  fillFractionAfterQueue: number;
}
```

Update the class fields and constructor:

```ts
export class PaperExecutionEngine {
  private orders: Map<string, PaperOrder> = new Map();
  private filledSizes: Map<string, number> = new Map();
  private crossedTradeSizes: Map<string, number> = new Map();

  constructor(private config: PaperExecutionConfig | null = null) {}
```

In `submit`, add:

```ts
    this.crossedTradeSizes.set(order.id, 0);
```

In `cancel` and `cancelByTokenId`, delete `crossedTradeSizes` for removed orders.

- [ ] **Step 6: Implement conservative fill sizing**

Replace the `if (shouldFill) { ... }` body in `onTrade` with:

```ts
      if (shouldFill) {
        const fillSize = this.computeFillSize(orderId, remaining, trade.size);
        if (fillSize <= 0) continue;

        this.filledSizes.set(orderId, alreadyFilled + fillSize);
        fills.push({
          orderId, tokenId: order.tokenId, side: order.side,
          filledPrice: order.price, filledSize: fillSize, remainingSize: remaining - fillSize
        });
        if (alreadyFilled + fillSize >= order.size) {
          this.orders.delete(orderId);
          this.filledSizes.delete(orderId);
          this.crossedTradeSizes.delete(orderId);
        }
      }
```

Add this private method before the class closing brace:

```ts
  private computeFillSize(orderId: string, remaining: number, tradeSize: number): number {
    if (!this.config) return Math.min(remaining, tradeSize);

    const previousCrossedSize = this.crossedTradeSizes.get(orderId) ?? 0;
    const totalCrossedSize = previousCrossedSize + tradeSize;
    this.crossedTradeSizes.set(orderId, totalCrossedSize);

    const fillableCrossedSize = Math.max(0, totalCrossedSize - this.config.queueAheadSize);
    const previousFillableCrossedSize = Math.max(0, previousCrossedSize - this.config.queueAheadSize);
    const newlyFillableSize = fillableCrossedSize - previousFillableCrossedSize;
    const conservativeFillSize = newlyFillableSize * this.config.fillFractionAfterQueue;

    return Math.min(remaining, conservativeFillSize);
  }
```

- [ ] **Step 7: Wire paper runner to conservative engine**

In `src/run-paper.ts`, replace:

```ts
  const execution = new PaperExecutionEngine();
```

with:

```ts
  const execution = new PaperExecutionEngine(config.paperExecution);
```

- [ ] **Step 8: Run focused simulation test and verify it passes**

Run:

```bash
docker compose run --rm polymarket-bot npm test -- tests/simulation/paper-execution-engine.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/types/config.ts src/strategy/config.ts src/simulation/paper-execution-engine.ts src/run-paper.ts tests/simulation/paper-execution-engine.test.ts
git commit -m "feat(simulation): add conservative paper fill model"
```

---

## Task 5: Add paper-soak go/no-go report action text

**Files:**
- Modify: `src/reporting/telegram-risk-report.ts`
- Test: `tests/integration/risk-gated-paper-report.test.ts`

- [ ] **Step 1: Write failing report test**

Append to `tests/integration/risk-gated-paper-report.test.ts`:

```ts
test('report action blocks live when severe negative exit persists before soak deadline', () => {
  const report = formatTelegramRiskReport({
    mode: 'paper',
    generatedAt: new Date('2026-05-30T05:00:00Z'),
    uptimeMs: 12 * 60 * 60 * 1000,
    health: { errors: 0, warnings: 0 },
    pnl: {
      realizedPeriod: 10,
      realizedTotal: 10,
      unrealized: -0.2,
      estimatedRebates: 0,
      estimatedTotal: 9.8,
      estimatedTotalExRebates: 9.8,
      valuation: 'fair-based',
    },
    activity: {
      fillCount: 1,
      buyFillCount: 1,
      sellFillCount: 0,
      buyContracts: 1,
      sellContracts: 0,
      buyVolumeUsd: 0.5,
      sellVolumeUsd: 0,
      totalContracts: 1,
      totalVolumeUsd: 0.5,
      activeMarkets: 1,
      openPositions: 1,
      quoteGeneratedCount: 10,
      quoteRejectedCount: 1,
      quoteSkippedCount: 0,
      staleBookSkippedCount: 0,
      invalidBookSkippedCount: 0,
      invalidFairSkippedCount: 0,
      cooldownSkippedCount: 0,
      quoteEngineNullSkippedCount: 0,
      unchangedSkippedCount: 0,
      primaryMarketConditionId: 'market-1',
      primaryMarketQuoteCount: 10,
      primaryMarketQuoteSharePct: 100,
    },
    risk: {
      status: 'CRITICAL',
      reasons: ['severe_negative_executable_exit'],
      quoteConcentrationPct: 10,
      unrealizedToRealizedRatio: 0.02,
      worstCaseLossToZero: -0.2,
      killSwitchActive: false,
      exitPnlAtBestBidAsk: -0.3,
      timeInNonOkMs: 12 * 60 * 60 * 1000,
    },
    inventory: {
      positionSide: 'LONG',
      netPosition: 1,
      avgEntryPrice: 0.6,
      currentFair: 0.55,
      currentBid: 0.3,
      currentAsk: 0.4,
      inventoryUsagePct: 20,
      reduceOnly: true,
    },
    topInventoryMarkets: [],
    mainMarketTitle: 'Example Market',
    riskTrajectory: null,
  });

  expect(report).toContain('Stay PAPER');
  expect(report).toContain('Do not enable LIVE before the paper soak clears severe executable-exit risk.');
});
```

If existing formatter input types differ, adapt only field names to match current `formatTelegramRiskReport` call sites; keep the assertion text exactly.

- [ ] **Step 2: Run focused integration test and verify it fails**

Run:

```bash
docker compose run --rm polymarket-bot npm test -- tests/integration/risk-gated-paper-report.test.ts --runInBand
```

Expected: FAIL because action text does not include the paper-soak live blocker sentence.

- [ ] **Step 3: Implement action text**

In `src/reporting/telegram-risk-report.ts`, find the action text function or inline `Action` section. For CRITICAL reports containing `severe_negative_executable_exit`, return/include:

```ts
'Stay PAPER. Do not enable LIVE before the paper soak clears severe executable-exit risk.'
```

If the existing text also mentions wide-book/executable-exit investigation, preserve it by appending this sentence rather than replacing useful guidance.

- [ ] **Step 4: Run focused integration test and verify it passes**

Run:

```bash
docker compose run --rm polymarket-bot npm test -- tests/integration/risk-gated-paper-report.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/reporting/telegram-risk-report.ts tests/integration/risk-gated-paper-report.test.ts
git commit -m "fix(reporting): show paper-soak blocker before live"
```

---

## Task 6: Final Docker verification

**Files:**
- No code changes expected.

- [ ] **Step 1: Run all tests through Docker**

```bash
docker compose run --rm polymarket-bot npm test -- --runInBand
```

Expected: PASS.

- [ ] **Step 2: Run build through Docker**

```bash
docker compose run --rm polymarket-bot npm run build
```

Expected: PASS.

- [ ] **Step 3: Check working tree**

```bash
git status --short
```

Expected: only pre-existing untracked files may remain:

```text
?? .claude/
?? .mcp.json
?? docs/superpowers/plans/2026-05-24-risk-reporting-wide-book-safety.md
```

- [ ] **Step 4: Deployment note for paper soak**

After implementation is verified, deploy in `paper` mode only. The Dockerfile currently runs `dist/run-paper.js`, so do not switch CMD to live in this plan. Production deployment should follow the project workflow:

```bash
ssh oraculus@46.225.147.43
cd /opt/polymarketmm
git pull
docker compose build --no-cache
docker compose up -d
```

Expected: bot remains in paper and produces post-change reports through 2026-05-31.

---

## Self-Review

Spec coverage:

- `$30` small-live limits: Task 1.
- `$5` absolute drawdown stop: Task 2.
- Negative executable-exit hard guard: Task 3.
- Conservative paper fill model: Task 4.
- Crossed/missing-book handling: existing `StrategyRiskManager` already blocks invalid/crossed books; this plan preserves that behavior and adds report gating in Task 5. If post-change reports still show persistent `invalid_book_crossed_or_missing`, diagnose from live paper logs before live enablement.
- Market quality gate: Task 3 blocks negative-exit inventory growth; existing stale/invalid book guards remain active.
- Paper soak through 2026-05-31: Task 5 action text and Task 6 deployment note.
- Docker-only testing: every command uses Docker Compose.

Red-flag scan: checked for ambiguous implementation instructions and removed them.

Type consistency:

- `maxDailyDrawdownUsd` is added to `RiskConfig` and consumed by `KillSwitch`.
- `currentDrawdownUsd` is optional on `Drawdown` to preserve existing callers.
- `paperExecution` is added to `StrategyConfig` and passed to `PaperExecutionEngine`.
- `PaperExecutionConfig` name is used consistently in config and simulation layers.
