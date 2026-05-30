# Risk Reporting Truthfulness and Wide-Book Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make paper risk reports truthful about quote skips/rejections and ensure wide-book or negative executable-exit risk changes report status/action before any move toward live trading.

**Architecture:** Keep this as a focused safety/reporting slice. Extend `TradingActivityTracker` with explicit quote-decision counters, wire the existing paper runner skip paths into those counters, and add executable-liquidity risk reasons inside `StrategyRiskManager` so report status is driven by the same decisions it displays. Do not change the paper fill model in this plan; that is a separate later slice.

**Tech Stack:** TypeScript, Jest, Docker-based test/build commands, existing Telegram report formatter, existing paper runner.

---

## File Structure

Modify these existing files only:

- `src/accounting/trading-activity-tracker.ts`
  - Owns aggregate activity counters.
  - Add explicit quote decision categories while preserving existing `quoteGeneratedCount` and `quoteRejectedCount` fields for compatibility.

- `src/run-paper.ts`
  - Owns paper-mode orchestration.
  - Record skip categories at the exact branch where the skip occurs.
  - Pass risk-manager config thresholds for executable-liquidity checks.

- `src/risk/strategy-risk-manager.ts`
  - Owns market risk decisions.
  - Add reasons/status escalation for wide books, invalid books, and negative executable exit.

- `src/reporting/telegram-risk-report.ts`
  - Owns Telegram report text and action guidance.
  - Display the new quote decision categories clearly.
  - Make actions mention wide-book/executable-exit reasons when present.

- `tests/accounting/trading-activity-tracker.test.ts`
  - Unit tests for new counters and primary market quote share.

- `tests/risk/strategy-risk-manager.test.ts`
  - Unit tests for wide book, invalid book, and negative executable exit status escalation.

- `tests/integration/risk-gated-paper-report.test.ts`
  - Integration test proving the Telegram report does not silently show OK for a wide-book negative-exit position.

Do not modify:

- `src/simulation/paper-execution-engine.ts`
- `src/simulation/queue-model.ts`
- `src/execution/order-router.ts`

Those belong to the later conservative paper-fill-model slice.

---

## Risk Reason Semantics

Use these exact reason strings:

- `wide_book_spread`
  - Book spread is known and exceeds configured `maxBookSpreadCents`.
  - Status: `WATCH` for flat/no position, `WARNING` when position is open.

- `invalid_book_crossed_or_missing`
  - Book is missing usable bid/ask or has `bestBid >= bestAsk`.
  - Status: `WARNING` when position is open, otherwise `WATCH`.
  - Blocks both sides because the market book is not safe for quoting.

- `negative_executable_exit`
  - Position has `exitPnlAtBestBidAsk < 0`.
  - Status: `WARNING`.
  - Does not force reduce-only in this slice; it is report/action hardening only.

- `severe_negative_executable_exit`
  - Position has `exitPnlAtBestBidAsk <= -1.00`.
  - Status: `CRITICAL`.
  - Blocks same-direction quoting by setting reduce-only behavior for the position side:
    - short position: block SELL, allow BUY;
    - long position: block BUY, allow SELL.

Why these thresholds:

- The observed incident was `-$0.68`; it should be `WARNING`, not silent `OK`.
- `-$1.00` is a conservative small-dollar critical threshold for current paper sizing and can be tuned later through config.
- Avoid introducing new env/config plumbing in this slice; keep defaults inside risk config wiring from existing market filter config.

---

## Task 1: Add explicit quote decision counters

**Files:**
- Modify: `src/accounting/trading-activity-tracker.ts`
- Test: `tests/accounting/trading-activity-tracker.test.ts`

- [ ] **Step 1: Write the failing accounting test**

Add this test to `tests/accounting/trading-activity-tracker.test.ts` after the existing `counts quote traces and primary market concentration` test:

```ts
test('counts explicit quote decision categories without changing fill metrics', () => {
  const tracker = new TradingActivityTracker();

  tracker.recordQuoteGenerated('market-1');
  tracker.recordQuoteRejected('market-1');
  tracker.recordQuoteSkipped('market-1', 'staleBookSkipped');
  tracker.recordQuoteSkipped('market-1', 'invalidBookSkipped');
  tracker.recordQuoteSkipped('market-2', 'invalidFairSkipped');
  tracker.recordQuoteSkipped('market-2', 'cooldownSkipped');
  tracker.recordQuoteSkipped('market-2', 'quoteEngineNullSkipped');
  tracker.recordQuoteSkipped('market-2', 'unchangedSkipped');

  const snapshot = tracker.snapshot();

  expect(snapshot.quoteGeneratedCount).toBe(1);
  expect(snapshot.quoteRejectedCount).toBe(1);
  expect(snapshot.quoteSkippedCount).toBe(6);
  expect(snapshot.staleBookSkippedCount).toBe(1);
  expect(snapshot.invalidBookSkippedCount).toBe(1);
  expect(snapshot.invalidFairSkippedCount).toBe(1);
  expect(snapshot.cooldownSkippedCount).toBe(1);
  expect(snapshot.quoteEngineNullSkippedCount).toBe(1);
  expect(snapshot.unchangedSkippedCount).toBe(1);
  expect(snapshot.quoteTraces).toBe(8);
  expect(snapshot.primaryMarketConditionId).toBe('market-2');
  expect(snapshot.primaryMarketQuoteTraces).toBe(4);
  expect(snapshot.primaryMarketQuoteSharePct).toBeCloseTo(50);
  expect(snapshot.fillsTotal).toBe(0);
});
```

- [ ] **Step 2: Run the accounting test and verify it fails**

Run through Docker, not bare npm:

```bash
docker compose run --rm app npm test -- tests/accounting/trading-activity-tracker.test.ts --runInBand
```

Expected result: FAIL because `recordQuoteSkipped` and the new snapshot fields do not exist.

- [ ] **Step 3: Add skip counter types and implementation**

In `src/accounting/trading-activity-tracker.ts`, replace the snapshot interface with:

```ts
export type QuoteSkipReason =
  | 'staleBookSkipped'
  | 'invalidBookSkipped'
  | 'invalidFairSkipped'
  | 'cooldownSkipped'
  | 'quoteEngineNullSkipped'
  | 'unchangedSkipped';

export interface TradingActivitySnapshot {
  fillsTotal: number;
  buyFills: number;
  sellFills: number;
  buyContracts: number;
  sellContracts: number;
  totalContracts: number;
  buyNotional: number;
  sellNotional: number;
  notionalVolume: number;
  avgFillPrice: number | null;
  quoteTraces: number;
  quoteGeneratedCount: number;
  quoteRejectedCount: number;
  quoteSkippedCount: number;
  staleBookSkippedCount: number;
  invalidBookSkippedCount: number;
  invalidFairSkippedCount: number;
  cooldownSkippedCount: number;
  quoteEngineNullSkippedCount: number;
  unchangedSkippedCount: number;
  activeMarkets: number;
  primaryMarketConditionId: string | null;
  primaryMarketQuoteTraces: number;
  primaryMarketQuoteSharePct: number | null;
}
```

Add these private fields after `quoteRejectedCount`:

```ts
  private staleBookSkippedCount = 0;
  private invalidBookSkippedCount = 0;
  private invalidFairSkippedCount = 0;
  private cooldownSkippedCount = 0;
  private quoteEngineNullSkippedCount = 0;
  private unchangedSkippedCount = 0;
```

Add this method after `recordQuoteRejected()`:

```ts
  recordQuoteSkipped(conditionId: string, reason: QuoteSkipReason): void {
    this[`${reason}Count`] += 1;
    this.getMarketActivity(conditionId).quoteTraces += 1;
  }
```

In `snapshot()`, replace the `quoteTraces` calculation with:

```ts
    const quoteSkippedCount =
      this.staleBookSkippedCount +
      this.invalidBookSkippedCount +
      this.invalidFairSkippedCount +
      this.cooldownSkippedCount +
      this.quoteEngineNullSkippedCount +
      this.unchangedSkippedCount;
    const quoteTraces = this.quoteGeneratedCount + this.quoteRejectedCount + quoteSkippedCount;
```

Add these fields to the returned object after `quoteRejectedCount`:

```ts
      quoteSkippedCount,
      staleBookSkippedCount: this.staleBookSkippedCount,
      invalidBookSkippedCount: this.invalidBookSkippedCount,
      invalidFairSkippedCount: this.invalidFairSkippedCount,
      cooldownSkippedCount: this.cooldownSkippedCount,
      quoteEngineNullSkippedCount: this.quoteEngineNullSkippedCount,
      unchangedSkippedCount: this.unchangedSkippedCount,
```

- [ ] **Step 4: Run accounting tests and verify they pass**

```bash
docker compose run --rm app npm test -- tests/accounting/trading-activity-tracker.test.ts --runInBand
```

Expected result: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/accounting/trading-activity-tracker.ts tests/accounting/trading-activity-tracker.test.ts
git commit -m "feat(reporting): track quote skip categories"
```

---

## Task 2: Display truthful quote activity in Telegram reports

**Files:**
- Modify: `src/reporting/telegram-risk-report.ts`
- Test: `tests/integration/risk-gated-paper-report.test.ts`

- [ ] **Step 1: Write the failing report assertion**

In `tests/integration/risk-gated-paper-report.test.ts`, inside the existing test before `const activity = activityTracker.snapshot();`, add:

```ts
    activityTracker.recordQuoteSkipped('market-1', 'staleBookSkipped');
    activityTracker.recordQuoteSkipped('market-1', 'quoteEngineNullSkipped');
```

After the existing report assertions, add:

```ts
    expect(text).toContain('Quotes: 4 submitted/replaced: 2 risk-blocked: 0 skipped: 2');
    expect(text).toContain('Skips: stale book 1, invalid book 0, invalid fair 0, cooldown 0, no quote 1, unchanged 0');
```

- [ ] **Step 2: Run the integration test and verify it fails**

```bash
docker compose run --rm app npm test -- tests/integration/risk-gated-paper-report.test.ts --runInBand
```

Expected result: FAIL because the report still says `generated` and `rejected` and does not include skip breakdown.

- [ ] **Step 3: Update the Activity section text**

In `src/reporting/telegram-risk-report.ts`, replace line 85-style quote text:

```ts
Quotes: ${formatInteger(input.activity.quoteTraces)} generated: ${formatInteger(input.activity.quoteGeneratedCount)} rejected: ${formatInteger(input.activity.quoteRejectedCount)}
```

with:

```ts
Quotes: ${formatInteger(input.activity.quoteTraces)} submitted/replaced: ${formatInteger(input.activity.quoteGeneratedCount)} risk-blocked: ${formatInteger(input.activity.quoteRejectedCount)} skipped: ${formatInteger(input.activity.quoteSkippedCount)}
Skips: stale book ${formatInteger(input.activity.staleBookSkippedCount)}, invalid book ${formatInteger(input.activity.invalidBookSkippedCount)}, invalid fair ${formatInteger(input.activity.invalidFairSkippedCount)}, cooldown ${formatInteger(input.activity.cooldownSkippedCount)}, no quote ${formatInteger(input.activity.quoteEngineNullSkippedCount)}, unchanged ${formatInteger(input.activity.unchangedSkippedCount)}
```

- [ ] **Step 4: Run report integration test and accounting test**

```bash
docker compose run --rm app npm test -- tests/integration/risk-gated-paper-report.test.ts tests/accounting/trading-activity-tracker.test.ts --runInBand
```

Expected result: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/reporting/telegram-risk-report.ts tests/integration/risk-gated-paper-report.test.ts
git commit -m "feat(reporting): show quote skip breakdown"
```

---

## Task 3: Wire paper runner skip paths into quote counters

**Files:**
- Modify: `src/run-paper.ts`

- [ ] **Step 1: Add skip accounting at missing-book branch**

In `src/run-paper.ts`, replace:

```ts
    if (!yesBook || !noBook) return;
```

with:

```ts
    if (!yesBook || !noBook) {
      activityTracker.recordQuoteSkipped(market.conditionId, 'invalidBookSkipped');
      return;
    }
```

- [ ] **Step 2: Add skip accounting at stale-book branch**

In the stale book branch, immediately before `return;`, add:

```ts
      activityTracker.recordQuoteSkipped(market.conditionId, 'staleBookSkipped');
```

The end of the branch should be:

```ts
      if (hasActiveQuotesBeforeFair) {
        cancelMarketOrders(market.conditionId);
      }
      activityTracker.recordQuoteSkipped(market.conditionId, 'staleBookSkipped');
      return;
```

- [ ] **Step 3: Add skip accounting at invalid-fair branch**

Replace:

```ts
    if (!yesFair) return;
```

with:

```ts
    if (!yesFair) {
      activityTracker.recordQuoteSkipped(market.conditionId, 'invalidFairSkipped');
      return;
    }
```

- [ ] **Step 4: Add skip accounting at cooldown branch**

Replace:

```ts
    if (now - lastQuote < QUOTE_COOLDOWN_MS) return;
```

with:

```ts
    if (now - lastQuote < QUOTE_COOLDOWN_MS) {
      activityTracker.recordQuoteSkipped(market.conditionId, 'cooldownSkipped');
      return;
    }
```

- [ ] **Step 5: Add skip accounting when quote engine returns null**

Replace:

```ts
      const quotes = quoteResult ? [quoteResult.candidate] : [];

      for (const quote of quotes) {
```

with:

```ts
      if (!quoteResult) {
        activityTracker.recordQuoteSkipped(market.conditionId, 'quoteEngineNullSkipped');
        continue;
      }

      const quotes = [quoteResult.candidate];

      for (const quote of quotes) {
```

- [ ] **Step 6: Add skip accounting when quote is unchanged**

Replace:

```ts
        if (!shouldReplace(current, quote.price, quote.size, now)) {
          continue;
        }
```

with:

```ts
        if (!shouldReplace(current, quote.price, quote.size, now)) {
          activityTracker.recordQuoteSkipped(market.conditionId, 'unchangedSkipped');
          continue;
        }
```

- [ ] **Step 7: Run focused tests**

```bash
docker compose run --rm app npm test -- tests/accounting/trading-activity-tracker.test.ts tests/integration/risk-gated-paper-report.test.ts --runInBand
```

Expected result: PASS.

- [ ] **Step 8: Run TypeScript build**

```bash
docker compose run --rm app npm run build
```

Expected result: PASS.

- [ ] **Step 9: Commit Task 3**

```bash
git add src/run-paper.ts
git commit -m "feat(paper): record quote skip reasons"
```

---

## Task 4: Add executable-liquidity risk checks

**Files:**
- Modify: `src/risk/strategy-risk-manager.ts`
- Test: `tests/risk/strategy-risk-manager.test.ts`

- [ ] **Step 1: Write failing tests for wide book and negative exit**

Add these tests to `tests/risk/strategy-risk-manager.test.ts` before the final `});`:

```ts
test('warns when an open short has negative executable exit despite low inventory usage', () => {
  const manager = new StrategyRiskManager({
    ...config,
    maxMarketExposureUsd: 10,
  });

  const decision = manager.evaluateMarket({
    mode: 'paper',
    conditionId: 'market-1',
    tokenId: 'token-yes',
    position: makePosition({ netSize: -2, avgCost: 0.65 }),
    book: makeBook({ bestBid: 0.01, bestAsk: 0.99, spread: 0.98, spreadTicks: 98 }),
    currentFair: 0.2555,
    primaryMarketQuoteSharePct: 50,
    hasActiveQuotes: true,
    isBookStale: false,
    killSwitchActive: false,
  });

  expect(decision.inventoryUsagePct).toBeCloseTo(5.11);
  expect(decision.exitPnlAtBestBidAsk).toBeCloseTo(-0.68);
  expect(decision.riskStatus).toBe('WARNING');
  expect(decision.reasons).toContain('negative_executable_exit');
  expect(decision.reasons).toContain('wide_book_spread');
  expect(decision.reduceOnly).toBe(false);
  expect(decision.allowBuy).toBe(true);
  expect(decision.allowSell).toBe(true);
});

test('blocks both sides and warns on crossed book', () => {
  const manager = new StrategyRiskManager(config);

  const decision = manager.evaluateMarket({
    mode: 'paper',
    conditionId: 'market-1',
    tokenId: 'token-yes',
    position: makePosition({ netSize: 1, avgCost: 0.50 }),
    book: makeBook({ bestBid: 0.60, bestAsk: 0.59, spread: -0.01, spreadTicks: -1 }),
    currentFair: 0.55,
    primaryMarketQuoteSharePct: 50,
    hasActiveQuotes: true,
    isBookStale: false,
    killSwitchActive: false,
  });

  expect(decision.riskStatus).toBe('WARNING');
  expect(decision.reasons).toContain('invalid_book_crossed_or_missing');
  expect(decision.allowBuy).toBe(false);
  expect(decision.allowSell).toBe(false);
});

test('escalates severe negative executable exit to critical reduce-only behavior', () => {
  const manager = new StrategyRiskManager(config);

  const decision = manager.evaluateMarket({
    mode: 'paper',
    conditionId: 'market-1',
    tokenId: 'token-yes',
    position: makePosition({ netSize: -4, avgCost: 0.50 }),
    book: makeBook({ bestBid: 0.01, bestAsk: 0.90, spread: 0.89, spreadTicks: 89 }),
    currentFair: 0.25,
    primaryMarketQuoteSharePct: 50,
    hasActiveQuotes: true,
    isBookStale: false,
    killSwitchActive: false,
  });

  expect(decision.exitPnlAtBestBidAsk).toBeCloseTo(-1.60);
  expect(decision.riskStatus).toBe('CRITICAL');
  expect(decision.reasons).toContain('severe_negative_executable_exit');
  expect(decision.reduceOnly).toBe(true);
  expect(decision.allowBuy).toBe(true);
  expect(decision.allowSell).toBe(false);
});
```

- [ ] **Step 2: Run risk tests and verify they fail**

```bash
docker compose run --rm app npm test -- tests/risk/strategy-risk-manager.test.ts --runInBand
```

Expected result: FAIL because the new risk reasons/status escalation do not exist.

- [ ] **Step 3: Extend risk config**

In `src/risk/strategy-risk-manager.ts`, add these fields to `StrategyRiskConfig` after `concentrationCriticalPctLive`:

```ts
  maxBookSpreadCents?: number;
  negativeExitWarningUsd?: number;
  negativeExitCriticalUsd?: number;
```

- [ ] **Step 4: Compute executable exit before returning decision**

Inside `evaluateMarket()`, after `let allowSell = true;`, add:

```ts
    const exitPnlAtBestBidAsk = this.computeExitPnlAtBestBidAsk(netPosition, avgEntryPrice, input.book);
```

In the returned object, replace:

```ts
      exitPnlAtBestBidAsk: this.computeExitPnlAtBestBidAsk(netPosition, avgEntryPrice, input.book),
```

with:

```ts
      exitPnlAtBestBidAsk,
```

- [ ] **Step 5: Add book validity and spread reasons**

Inside `evaluateMarket()`, after the kill-switch block, add:

```ts
    const hasOpenPosition = netPosition !== 0;
    const bestBid = input.book?.bestBid ?? null;
    const bestAsk = input.book?.bestAsk ?? null;

    if (bestBid === null || bestAsk === null || bestBid <= 0 || bestAsk <= 0 || bestBid >= bestAsk) {
      allowBuy = false;
      allowSell = false;
      reasons.push('invalid_book_crossed_or_missing');
    } else {
      const spreadCents = (bestAsk - bestBid) * 100;
      const maxBookSpreadCents = this.config.maxBookSpreadCents ?? 8;
      if (spreadCents > maxBookSpreadCents) {
        reasons.push('wide_book_spread');
      }
    }
```

- [ ] **Step 6: Add negative executable exit reasons and severe reduce-only behavior**

Immediately after the block from Step 5, add:

```ts
    const negativeExitWarningUsd = this.config.negativeExitWarningUsd ?? 0;
    const negativeExitCriticalUsd = this.config.negativeExitCriticalUsd ?? -1;

    if (hasOpenPosition && exitPnlAtBestBidAsk !== null && exitPnlAtBestBidAsk < negativeExitWarningUsd) {
      reasons.push('negative_executable_exit');
    }

    if (hasOpenPosition && exitPnlAtBestBidAsk !== null && exitPnlAtBestBidAsk <= negativeExitCriticalUsd) {
      reduceOnly = true;
      reasons.push('severe_negative_executable_exit');
      if (netPosition < 0) {
        allowSell = false;
      } else if (netPosition > 0) {
        allowBuy = false;
      }
    }
```

- [ ] **Step 7: Extend `computeRiskStatus()`**

In `computeRiskStatus()`, add `severe_negative_executable_exit` to the CRITICAL block:

```ts
      reasons.includes('single_market_concentration_critical') ||
      reasons.includes('severe_negative_executable_exit')
```

Add this WARNING block before the existing `single_market_concentration_warning` block:

```ts
    if (
      reasons.includes('invalid_book_crossed_or_missing') ||
      reasons.includes('negative_executable_exit') ||
      reasons.includes('wide_book_spread')
    ) {
      return 'WARNING';
    }
```

- [ ] **Step 8: Run risk tests and verify they pass**

```bash
docker compose run --rm app npm test -- tests/risk/strategy-risk-manager.test.ts --runInBand
```

Expected result: PASS.

- [ ] **Step 9: Commit Task 4**

```bash
git add src/risk/strategy-risk-manager.ts tests/risk/strategy-risk-manager.test.ts
git commit -m "feat(risk): flag wide-book executable exit risk"
```

---

## Task 5: Wire configured spread threshold into paper risk manager

**Files:**
- Modify: `src/run-paper.ts`

- [ ] **Step 1: Pass existing market max spread into risk manager config**

In `src/run-paper.ts`, update the `new StrategyRiskManager({ ... })` block to include:

```ts
    maxBookSpreadCents: config.marketFilter.maxSpreadCents,
    negativeExitWarningUsd: 0,
    negativeExitCriticalUsd: -1,
```

The block should include these fields after `concentrationCriticalPctLive: 90,` and before `throttleProfiles`.

- [ ] **Step 2: Run risk and integration tests**

```bash
docker compose run --rm app npm test -- tests/risk/strategy-risk-manager.test.ts tests/integration/risk-gated-paper-report.test.ts --runInBand
```

Expected result: PASS.

- [ ] **Step 3: Run TypeScript build**

```bash
docker compose run --rm app npm run build
```

Expected result: PASS.

- [ ] **Step 4: Commit Task 5**

```bash
git add src/run-paper.ts
git commit -m "feat(paper): configure executable liquidity risk"
```

---

## Task 6: Improve Telegram action guidance for liquidity risk

**Files:**
- Modify: `src/reporting/telegram-risk-report.ts`
- Test: `tests/integration/risk-gated-paper-report.test.ts`

- [ ] **Step 1: Add failing integration assertions for action guidance**

Add a second test to `tests/integration/risk-gated-paper-report.test.ts`:

```ts
test('negative executable exit appears as warning action in paper report', () => {
  const activityTracker = new TradingActivityTracker();
  const riskManager = new StrategyRiskManager({
    softInventoryLimitPct: 25,
    reduceOnlyLimitPct: 70,
    hardInventoryLimitPct: 90,
    maxMarketExposureUsd: 10,
    concentrationWarningPct: 90,
    concentrationCriticalPctLive: 90,
    maxBookSpreadCents: 8,
    negativeExitWarningUsd: 0,
    negativeExitCriticalUsd: -1,
  });

  activityTracker.recordQuoteGenerated('market-1');

  const decision = riskManager.evaluateMarket({
    mode: 'paper',
    conditionId: 'market-1',
    tokenId: 'token-yes',
    position: {
      tokenId: 'token-yes',
      netSize: -2,
      avgCost: 0.65,
      realizedPnl: 0,
      totalBoughtUsd: 0,
      totalSoldUsd: 1.30,
      totalVolumeUsd: 1.30,
    },
    book: {
      ...makeBook(),
      bestBid: 0.01,
      bestAsk: 0.99,
      midpoint: 0.50,
      spread: 0.98,
      spreadTicks: 98,
    },
    currentFair: 0.2555,
    primaryMarketQuoteSharePct: activityTracker.snapshot().primaryMarketQuoteSharePct,
    hasActiveQuotes: true,
    isBookStale: false,
    killSwitchActive: false,
  });

  const text = formatTelegramRiskReport({
    mode: 'paper',
    startedAt: new Date('2026-05-24T00:00:00Z'),
    reportAt: new Date('2026-05-24T17:00:00Z'),
    warningsCount: 0,
    errorsCount: 0,
    pnl: {
      realizedPeriod: 0,
      realizedCumulative: 0,
      unrealizedFairBased: decision.fairUnrealizedPnl,
      estimatedMakerRebate: 0,
      estimatedTotalPnl: decision.fairUnrealizedPnl,
      valuationMode: 'fair',
    },
    activity: activityTracker.snapshot(),
    risk: {
      status: maxRiskStatus([decision.riskStatus]),
      reasons: decision.reasons,
      reduceOnlyActive: decision.reduceOnly,
      killSwitchActive: false,
      openPositions: 1,
      topMarketDecision: decision,
      topInventoryDecisions: [decision],
      singleMarketConcentrationPct: activityTracker.snapshot().primaryMarketQuoteSharePct,
      unrealizedToRealizedRatio: null,
    },
    marketTitleByConditionId: new Map([['market-1', 'Wide Book Test Market']]),
  });

  expect(text).toContain('Status: WARNING');
  expect(text).toContain('negative_executable_exit');
  expect(text).toContain('wide_book_spread');
  expect(text).toContain('Exit at Bid/Ask: -$0.68');
  expect(text).toContain('Stay PAPER. Investigate wide-book or executable-exit risk before considering LIVE.');
});
```

- [ ] **Step 2: Run integration test and verify it fails on action text**

```bash
docker compose run --rm app npm test -- tests/integration/risk-gated-paper-report.test.ts --runInBand
```

Expected result: FAIL because `formatAction()` still returns generic WARNING guidance.

- [ ] **Step 3: Add liquidity-specific action text**

In `src/reporting/telegram-risk-report.ts`, add this block in `formatAction()` after the `mode === 'disabled'` check and before the `status === 'OK'` check:

```ts
  if (
    reasons.includes('wide_book_spread') ||
    reasons.includes('negative_executable_exit') ||
    reasons.includes('severe_negative_executable_exit') ||
    reasons.includes('invalid_book_crossed_or_missing')
  ) {
    return mode === 'paper'
      ? 'Stay PAPER. Investigate wide-book or executable-exit risk before considering LIVE.'
      : 'Executable liquidity risk active. Reduce exposure and inspect affected markets.';
  }
```

- [ ] **Step 4: Run integration test and verify it passes**

```bash
docker compose run --rm app npm test -- tests/integration/risk-gated-paper-report.test.ts --runInBand
```

Expected result: PASS.

- [ ] **Step 5: Commit Task 6**

```bash
git add src/reporting/telegram-risk-report.ts tests/integration/risk-gated-paper-report.test.ts
git commit -m "feat(reporting): guide executable liquidity warnings"
```

---

## Task 7: Full verification

**Files:**
- No code changes expected.

- [ ] **Step 1: Run full test suite through Docker**

```bash
docker compose run --rm app npm test -- --runInBand
```

Expected result: PASS.

- [ ] **Step 2: Run TypeScript build through Docker**

```bash
docker compose run --rm app npm run build
```

Expected result: PASS.

- [ ] **Step 3: Inspect git status**

```bash
git status --short
```

Expected result: clean working tree after commits, or only intentionally untracked local config files that existed before this work.

- [ ] **Step 4: Push commits if authorized by the user**

Only run this if the user explicitly authorizes pushing:

```bash
git push
```

Expected result: branch pushed to configured remote.

---

## Out of Scope

Do not implement these in this plan:

- queue-position fill model;
- actual trade-size fill accounting;
- order placement latency;
- cancel/replace latency;
- moving paper execution through the live router;
- changing live/small_live order submission behavior.

Those should be handled in a separate conservative paper execution plan after this reporting/safety slice lands.

---

## Self-Review

Spec coverage:

- Quote reporting ambiguity is covered by Tasks 1–3.
- Wide-book and negative-exit status gap is covered by Tasks 4–6.
- Docker-only test/build requirement is covered in every command.
- Conservative paper fill model is explicitly out of scope for this plan.

Placeholder scan:

- No `TBD`, `TODO`, or open-ended implementation instructions remain.
- Every code-changing step includes exact code snippets.

Type consistency:

- `QuoteSkipReason` union values match all `recordQuoteSkipped()` calls.
- New `TradingActivitySnapshot` fields match Telegram report usage and tests.
- New risk config field names match `StrategyRiskManager` construction in tests and `run-paper.ts`.
- New risk reason strings match status logic, action logic, and tests.
