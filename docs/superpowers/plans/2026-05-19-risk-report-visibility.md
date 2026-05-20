# Risk Report Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add risk visibility fields to PAPER Telegram reports so rebate dependency, top inventory markets, non-OK duration, and risk trajectory are visible before live consideration.

**Architecture:** Keep trading behavior unchanged. Add small reporting-only types and helpers in `src/reporting/telegram-risk-report.ts`, add stateful report diagnostics in `src/run-paper.ts`, and test the formatter and diagnostics through existing Jest test files. The formatter owns presentation and action wording; `run-paper.ts` owns current/previous snapshot state.

**Tech Stack:** TypeScript, Jest, existing Telegram HTML formatter, existing `StrategyRiskManager` risk decision types.

---

## File Structure

- Modify `src/reporting/telegram-risk-report.ts`
  - Extend `TelegramRiskReportInput.risk` with optional `topInventoryDecisions`, `timeInNonOkStatusMs`, and `riskTrajectory`.
  - Add formatter helpers for ex-rebates PnL, top inventory markets, risk trajectory, duration fallback, and status-aware action text.
  - Keep helpers pure and side-effect free.

- Modify `src/run-paper.ts`
  - Track previous report inventory usage, status, reduce-only state, and reasons plus non-OK status start time inside `scheduleTelegramReports` closure.
  - Build top inventory decisions from `allDecisionsToReport`.
  - Pass diagnostics into `formatTelegramRiskReport`.
  - Do not change quote generation, risk limits, reduce-only logic, or execution.

- Modify `tests/reporting/telegram-risk-report.test.ts`
  - Add focused formatter tests for ex-rebates, top inventory markets, fallbacks, dynamic action, risk trajectory, and non-OK duration.

- Modify `tests/integration/risk-gated-paper-report.test.ts` if it asserts exact report content and needs updates for the new fields.

- Modify `tests/risk/strategy-risk-manager.test.ts` only if TypeScript type changes require test fixtures to include new properties. Prefer optional report-input fields to avoid touching risk-manager tests.

---

### Task 1: Formatter PnL ex-rebates and dynamic action

**Files:**
- Modify: `tests/reporting/telegram-risk-report.test.ts`
- Modify: `src/reporting/telegram-risk-report.ts`

- [ ] **Step 1: Add failing formatter assertions for ex-rebates and dynamic action**

In `tests/reporting/telegram-risk-report.test.ts`, update the existing `formats risk-oriented report with required sections and values` test by adding these assertions after the `Estimated Total`/PnL-related assertions:

```ts
expect(text).toContain('Estimated Total ex Rebates: +$15.91');
expect(text).toContain('Inspect top inventory markets and reduce exposure before considering LIVE.');
```

Add a new test below the existing null-top-market test:

```ts
test('uses inventory WATCH action when soft inventory limit is exceeded', () => {
  const text = formatTelegramRiskReport(makeInput({
    risk: {
      ...makeInput().risk,
      status: 'WATCH',
      reasons: ['inventory_soft_limit_exceeded'],
    },
  }));

  expect(text).toContain('Stay PAPER and monitor whether inventory decays back below soft limit.');
});
```

- [ ] **Step 2: Run formatter test to verify it fails**

Run:

```bash
npm test -- tests/reporting/telegram-risk-report.test.ts --runInBand
```

Expected: FAIL because `Estimated Total ex Rebates` and the new dynamic action text are not rendered yet.

- [ ] **Step 3: Implement ex-rebates line and dynamic action**

In `src/reporting/telegram-risk-report.ts`, add this constant near the top of `formatTelegramRiskReport` after `const worstCase = formatWorstCase(top);`:

```ts
const estimatedTotalExRebates = input.pnl.realizedCumulative + input.pnl.unrealizedFairBased;
```

In the PnL section, after `Estimated Total: ${formatSignedUsd(input.pnl.estimatedTotalPnl)}`, add:

```ts
Estimated Total ex Rebates: ${formatSignedUsd(estimatedTotalExRebates)}
```

Replace the Action section call:

```ts
${formatAction(input.mode)}
```

with:

```ts
${formatAction(input.mode, input.risk.status, input.risk.reasons)}
```

Replace the existing `formatAction` helper with:

```ts
function formatAction(mode: StrategyMode, status: RiskStatus, reasons: string[]): string {
  if (mode === 'disabled') return 'Bot disabled. Review configuration before enabling trading.';

  if (status === 'OK') {
    return 'Continue PAPER soak and monitor normal risk metrics.';
  }

  if (status === 'WATCH' && reasons.includes('inventory_soft_limit_exceeded')) {
    return 'Stay PAPER and monitor whether inventory decays back below soft limit.';
  }

  if (status === 'WATCH') {
    return 'Stay PAPER and inspect listed reasons before considering LIVE.';
  }

  if (status === 'WARNING') {
    return 'Inspect top inventory markets and reduce exposure before considering LIVE.';
  }

  return 'Review cancel and kill-switch path before continuing.';
}
```

- [ ] **Step 4: Run formatter test to verify it passes**

Run:

```bash
npm test -- tests/reporting/telegram-risk-report.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add src/reporting/telegram-risk-report.ts tests/reporting/telegram-risk-report.test.ts
git commit -m "$(cat <<'EOF'
feat(reporting): show rebate-independent pnl and action guidance

Add report visibility for estimated PnL without rebates and make the action section reflect current risk status.

Co-Authored-By: OpenClaude (gpt-5.5) <openclaude@gitlawb.com>
EOF
)"
```

---

### Task 2: Top inventory markets formatter

**Files:**
- Modify: `tests/reporting/telegram-risk-report.test.ts`
- Modify: `src/reporting/telegram-risk-report.ts`

- [ ] **Step 1: Add failing tests for top inventory markets and fallbacks**

In `tests/reporting/telegram-risk-report.test.ts`, add this test after the dynamic-action test from Task 1:

```ts
test('renders top inventory markets sorted by inventory usage', () => {
  const base = makeInput();
  const text = formatTelegramRiskReport(makeInput({
    risk: {
      ...base.risk,
      topInventoryDecisions: [
        {
          ...base.risk.topMarketDecision!,
          conditionId: 'market-low',
          tokenId: 'token-low',
          inventoryUsagePct: 12.5,
          netPosition: 4,
          positionSide: 'LONG',
          exitPnlAtBestBidAsk: null,
          reasons: [],
        },
        {
          ...base.risk.topMarketDecision!,
          conditionId: 'market-high',
          tokenId: 'token-high',
          inventoryUsagePct: 80,
          netPosition: -167,
          positionSide: 'SHORT',
          exitPnlAtBestBidAsk: 10.15,
          reasons: ['reduce_only_short_inventory'],
        },
      ],
    },
    marketTitleByConditionId: new Map([
      ['market-high', 'High Inventory Market'],
      ['market-low', 'Low Inventory Market'],
    ]),
  }));

  expect(text).toContain('Top Inventory Markets');
  expect(text).toContain('1. High Inventory Market — SHORT 167 usage 80.00% fair 0.5550 bid/ask 0.5500 / 0.5600 exit +$10.15 reasons reduce_only_short_inventory');
  expect(text).toContain('2. Low Inventory Market — LONG 4 usage 12.50% fair 0.5550 bid/ask 0.5500 / 0.5600 exit not available reasons none');
  expect(text.indexOf('High Inventory Market')).toBeLessThan(text.indexOf('Low Inventory Market'));
});

test('renders top inventory fallback when list is empty', () => {
  const base = makeInput();
  const text = formatTelegramRiskReport(makeInput({
    risk: {
      ...base.risk,
      topInventoryDecisions: [],
    },
  }));

  expect(text).toContain('Top Inventory Markets');
  expect(text).toContain('none');
});
```

- [ ] **Step 2: Run formatter test to verify it fails**

Run:

```bash
npm test -- tests/reporting/telegram-risk-report.test.ts --runInBand
```

Expected: FAIL because `topInventoryDecisions` is not part of the input type and the report section is not rendered.

- [ ] **Step 3: Extend report input type**

In `src/reporting/telegram-risk-report.ts`, add this optional field to `TelegramRiskReportInput.risk` after `topMarketDecision: MarketRiskDecision | null;`:

```ts
topInventoryDecisions?: MarketRiskDecision[];
```

- [ ] **Step 4: Render Top Inventory Markets section**

In `formatTelegramRiskReport`, add this constant after `const worstCase = formatWorstCase(top);`:

```ts
const topInventoryMarkets = formatTopInventoryMarkets(input);
```

Add this section after the existing `Inventory` section and before the `Risk` section:

```ts
📦 <b>Top Inventory Markets</b>
${topInventoryMarkets}

```

Add these helpers above `formatAction`:

```ts
function formatTopInventoryMarkets(input: TelegramRiskReportInput): string {
  const decisions = [...(input.risk.topInventoryDecisions ?? [])]
    .filter(decision => decision.positionSide !== 'FLAT' && decision.netPosition !== 0)
    .sort((a, b) => compareInventoryDecision(b, a))
    .slice(0, 5);

  if (decisions.length === 0) return 'none';

  return decisions
    .map((decision, index) => {
      const title = escapeHtml(input.marketTitleByConditionId.get(decision.conditionId) ?? decision.conditionId);
      const sideAndSize = `${decision.positionSide} ${formatContracts(Math.abs(decision.netPosition))}`;
      const usage = formatNullablePct(decision.inventoryUsagePct);
      const fair = formatNullablePrice(decision.currentFair);
      const bidAsk = `${formatNullablePrice(decision.currentBid)} / ${formatNullablePrice(decision.currentAsk)}`;
      const exit = decision.exitPnlAtBestBidAsk === null ? 'not available' : formatSignedUsd(decision.exitPnlAtBestBidAsk);
      const reasons = decision.reasons.length > 0 ? escapeHtml(decision.reasons.join(', ')) : 'none';

      return `${index + 1}. ${title} — ${sideAndSize} usage ${usage} fair ${fair} bid/ask ${bidAsk} exit ${exit} reasons ${reasons}`;
    })
    .join('\n');
}

function compareInventoryDecision(a: MarketRiskDecision, b: MarketRiskDecision): number {
  const usageA = a.inventoryUsagePct ?? -1;
  const usageB = b.inventoryUsagePct ?? -1;
  if (usageA !== usageB) return usageA - usageB;
  return Math.abs(a.netPosition) - Math.abs(b.netPosition);
}
```

- [ ] **Step 5: Run formatter test to verify it passes**

Run:

```bash
npm test -- tests/reporting/telegram-risk-report.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

Run:

```bash
git add src/reporting/telegram-risk-report.ts tests/reporting/telegram-risk-report.test.ts
git commit -m "$(cat <<'EOF'
feat(reporting): show top inventory markets

Surface the highest-risk open positions in Telegram reports with safe fallbacks for missing exit data.

Co-Authored-By: OpenClaude (gpt-5.5) <openclaude@gitlawb.com>
EOF
)"
```

---

### Task 3: Non-OK duration and risk trajectory formatter

**Files:**
- Modify: `tests/reporting/telegram-risk-report.test.ts`
- Modify: `src/reporting/telegram-risk-report.ts`

- [ ] **Step 1: Add failing formatter tests for duration and risk trajectory**

In `tests/reporting/telegram-risk-report.test.ts`, add these tests after the top inventory tests:

```ts
test('renders non-OK duration and worsening risk trajectory', () => {
  const base = makeInput();
  const text = formatTelegramRiskReport(makeInput({
    risk: {
      ...base.risk,
      status: 'WARNING',
      reasons: ['inventory_soft_limit_exceeded', 'reduce_only_long_inventory'],
      reduceOnly: true,
      timeInNonOkStatusMs: 90 * 60 * 1000,
      riskTrajectory: {
        previousStatus: 'WATCH',
        currentStatus: 'WARNING',
        previousUsagePct: 17.1,
        currentUsagePct: 58.8,
        usageDirection: 'worsening',
        previousReduceOnly: false,
        currentReduceOnly: true,
        previousReasons: ['inventory_soft_limit_exceeded'],
        currentReasons: ['inventory_soft_limit_exceeded', 'reduce_only_long_inventory'],
      },
    },
  }));

  expect(text).toContain('Time in Non-OK: 1h 30m');
  expect(text).toContain('Risk Trajectory');
  expect(text).toContain('Status: WATCH → WARNING');
  expect(text).toContain('Inventory Usage: 17.10% → 58.80% worsening');
  expect(text).toContain('Reduce-only: OFF → ON');
  expect(text).toContain('Reasons: inventory_soft_limit_exceeded → inventory_soft_limit_exceeded, reduce_only_long_inventory');
});

test('renders diagnostic fallbacks when duration and trajectory are unavailable', () => {
  const text = formatTelegramRiskReport(makeInput());

  expect(text).toContain('Time in Non-OK: n/a');
  expect(text).toContain('Status: n/a');
  expect(text).toContain('Inventory Usage: n/a');
  expect(text).toContain('Reduce-only: n/a');
  expect(text).toContain('Reasons: n/a');
});
```

- [ ] **Step 2: Run formatter test to verify it fails**

Run:

```bash
npm test -- tests/reporting/telegram-risk-report.test.ts --runInBand
```

Expected: FAIL because duration/trajectory input fields and report lines do not exist yet.

- [ ] **Step 3: Add report diagnostic types**

In `src/reporting/telegram-risk-report.ts`, add this exported type after the imports:

```ts
export type RiskTrajectoryDirection = 'improving' | 'worsening' | 'flat';

export interface RiskTrajectorySnapshot {
  previousStatus: 'OK' | 'WATCH' | 'WARNING' | 'CRITICAL' | null;
  currentStatus: 'OK' | 'WATCH' | 'WARNING' | 'CRITICAL' | null;
  previousUsagePct: number | null;
  currentUsagePct: number | null;
  usageDirection: RiskTrajectoryDirection | null;
  previousReduceOnly: boolean | null;
  currentReduceOnly: boolean | null;
  previousReasons: string[] | null;
  currentReasons: string[] | null;
}
```

Add these optional fields to `TelegramRiskReportInput.risk` after `unrealizedToRealizedRatio: number | null;`:

```ts
timeInNonOkStatusMs?: number | null;
riskTrajectory?: RiskTrajectorySnapshot | null;
```

- [ ] **Step 4: Render duration and risk trajectory in Risk section**

In the Risk section, after `Unrealized/Realized: ...`, add:

```ts
Time in Non-OK: ${formatOptionalDuration(input.risk.timeInNonOkStatusMs ?? null)}
```

Then add a separate section after the risk lines:

```ts
lines.push('');
lines.push('📉 Risk Trajectory');
for (const line of formatRiskTrajectory(input.risk.riskTrajectory ?? null)) {
  lines.push(line);
}
```

Add these helpers above `formatWorstCase`:

```ts
function formatOptionalDuration(ms: number | null): string {
  return ms === null ? 'n/a' : formatDuration(ms);
}

function formatReduceOnlyTransition(value: boolean | null): string {
  if (value === null) return 'n/a';
  return value ? 'ON' : 'OFF';
}

function formatReasonsTransition(reasons: string[] | null): string {
  if (reasons === null) return 'n/a';
  return reasons.length > 0 ? reasons.join(', ') : 'none';
}

function formatRiskTrajectory(trajectory: RiskTrajectorySnapshot | null): string[] {
  if (trajectory === null) {
    return [
      'Status: n/a',
      'Inventory Usage: n/a',
      'Reduce-only: n/a',
      'Reasons: n/a',
    ];
  }

  const status = trajectory.previousStatus === null || trajectory.currentStatus === null
    ? 'n/a'
    : `${trajectory.previousStatus} → ${trajectory.currentStatus}`;

  const usage = trajectory.previousUsagePct === null || trajectory.currentUsagePct === null || trajectory.usageDirection === null
    ? 'n/a'
    : `${formatNullablePct(trajectory.previousUsagePct)} → ${formatNullablePct(trajectory.currentUsagePct)} ${trajectory.usageDirection}`;

  const reduceOnly = trajectory.previousReduceOnly === null || trajectory.currentReduceOnly === null
    ? 'n/a'
    : `${formatReduceOnlyTransition(trajectory.previousReduceOnly)} → ${formatReduceOnlyTransition(trajectory.currentReduceOnly)}`;

  const reasons = trajectory.previousReasons === null || trajectory.currentReasons === null
    ? 'n/a'
    : `${formatReasonsTransition(trajectory.previousReasons)} → ${formatReasonsTransition(trajectory.currentReasons)}`;

  return [
    `Status: ${status}`,
    `Inventory Usage: ${usage}`,
    `Reduce-only: ${reduceOnly}`,
    `Reasons: ${reasons}`,
  ];
}
```

- [ ] **Step 5: Run formatter test to verify it passes**

Run:

```bash
npm test -- tests/reporting/telegram-risk-report.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

Run:

```bash
git add src/reporting/telegram-risk-report.ts tests/reporting/telegram-risk-report.test.ts
git commit -m "$(cat <<'EOF'
feat(reporting): show risk trajectory diagnostics

Add non-OK duration and risk trajectory fields to Telegram reports so WATCH/WARNING states can be assessed over time.

Co-Authored-By: OpenClaude (gpt-5.5) <openclaude@gitlawb.com>
EOF
)"
```

---

### Task 4: Paper report diagnostic state wiring

**Files:**
- Modify: `src/run-paper.ts`
- Modify: `tests/reporting/telegram-risk-report.test.ts`

- [ ] **Step 1: Add formatter test for fields passed by runtime shape**

In `tests/reporting/telegram-risk-report.test.ts`, add this test after duration/trajectory tests to lock the expected runtime payload shape:

```ts
test('accepts runtime-provided top inventory diagnostics', () => {
  const base = makeInput();
  const text = formatTelegramRiskReport(makeInput({
    risk: {
      ...base.risk,
      topInventoryDecisions: [base.risk.topMarketDecision!],
      timeInNonOkStatusMs: 5 * 60 * 1000,
      riskTrajectory: {
        previousStatus: 'WARNING',
        currentStatus: 'WARNING',
        previousUsagePct: 80,
        currentUsagePct: 80,
        usageDirection: 'flat',
        previousReduceOnly: true,
        currentReduceOnly: true,
        previousReasons: ['inventory_soft_limit_exceeded'],
        currentReasons: ['inventory_soft_limit_exceeded'],
      },
    },
  }));

  expect(text).toContain('Top Inventory Markets');
  expect(text).toContain('Time in Non-OK: 5m');
  expect(text).toContain('Inventory Usage: 80.00% → 80.00% flat');
});
```

- [ ] **Step 2: Run build to verify current runtime wiring is incomplete after type additions**

Run:

```bash
npm run build
```

Expected: It may PASS because the new report fields are optional. Continue to Step 3 either way.

- [ ] **Step 3: Import risk trajectory type in runtime**

In `src/run-paper.ts`, update the existing import:

```ts
import { formatTelegramRiskReport } from './reporting/telegram-risk-report';
```

to:

```ts
import { formatTelegramRiskReport, RiskTrajectorySnapshot } from './reporting/telegram-risk-report';
```

- [ ] **Step 4: Add report diagnostic state inside `scheduleTelegramReports`**

Near the top of `scheduleTelegramReports`, before `function scheduleReport(hourUtc: number)`, add:

```ts
  let nonOkStatusStartedAtMs: number | null = null;
  let previousRiskSnapshot: {
    status: 'OK' | 'WATCH' | 'WARNING' | 'CRITICAL';
    usagePct: number | null;
    reduceOnly: boolean;
    reasons: string[];
  } | null = null;
```

- [ ] **Step 5: Add top inventory and risk trajectory helpers inside `scheduleTelegramReports`**

Inside `scheduleTelegramReports`, before `function scheduleReport(hourUtc: number)`, add:

```ts
  function getTopInventoryDecisions(decisions: MarketRiskDecision[]): MarketRiskDecision[] {
    return [...decisions]
      .filter(decision => decision.positionSide !== 'FLAT' && decision.netPosition !== 0)
      .sort((a, b) => {
        const usageA = a.inventoryUsagePct ?? -1;
        const usageB = b.inventoryUsagePct ?? -1;
        if (usageA !== usageB) return usageB - usageA;
        return Math.abs(b.netPosition) - Math.abs(a.netPosition);
      })
      .slice(0, 5);
  }

  function buildRiskTrajectory(snapshot: {
    status: 'OK' | 'WATCH' | 'WARNING' | 'CRITICAL';
    usagePct: number | null;
    reduceOnly: boolean;
    reasons: string[];
  }): RiskTrajectorySnapshot {
    if (previousRiskSnapshot === null) {
      return {
        previousStatus: null,
        currentStatus: snapshot.status,
        previousUsagePct: null,
        currentUsagePct: snapshot.usagePct,
        usageDirection: null,
        previousReduceOnly: null,
        currentReduceOnly: snapshot.reduceOnly,
        previousReasons: null,
        currentReasons: snapshot.reasons,
      };
    }

    let usageDirection: RiskTrajectorySnapshot['usageDirection'] = null;
    if (previousRiskSnapshot.usagePct !== null && snapshot.usagePct !== null) {
      if (snapshot.usagePct < previousRiskSnapshot.usagePct) usageDirection = 'improving';
      else if (snapshot.usagePct > previousRiskSnapshot.usagePct) usageDirection = 'worsening';
      else usageDirection = 'flat';
    }

    return {
      previousStatus: previousRiskSnapshot.status,
      currentStatus: snapshot.status,
      previousUsagePct: previousRiskSnapshot.usagePct,
      currentUsagePct: snapshot.usagePct,
      usageDirection,
      previousReduceOnly: previousRiskSnapshot.reduceOnly,
      currentReduceOnly: snapshot.reduceOnly,
      previousReasons: previousRiskSnapshot.reasons,
      currentReasons: snapshot.reasons,
    };
  }
```

If `MarketRiskDecision` is not imported in `src/run-paper.ts`, add it to the existing risk import from `./risk/strategy-risk-manager`.

- [ ] **Step 6: Compute diagnostics before formatting report**

In `src/run-paper.ts`, after `const globalRiskStatus = maxRiskStatus(allDecisionsToReport.map(d => d.riskStatus));`, add:

```ts
      if (globalRiskStatus === 'OK') {
        nonOkStatusStartedAtMs = null;
      } else if (nonOkStatusStartedAtMs === null) {
        nonOkStatusStartedAtMs = nowMs;
      }

      const timeInNonOkStatusMs = nonOkStatusStartedAtMs === null ? null : nowMs - nonOkStatusStartedAtMs;
      const topInventoryDecisions = getTopInventoryDecisions(allDecisionsToReport);
      const currentTopInventoryUsagePct = topInventoryDecisions[0]?.inventoryUsagePct ?? null;
      const currentRiskSnapshot = {
        status: globalRiskStatus,
        usagePct: currentTopInventoryUsagePct,
        reduceOnly: allDecisionsToReport.some(decision => decision.reduceOnly),
        reasons: Array.from(new Set(allDecisionsToReport.flatMap(decision => decision.reasons))).sort(),
      };
      const riskTrajectory = buildRiskTrajectory(currentRiskSnapshot);
      previousRiskSnapshot = currentRiskSnapshot;
```

- [ ] **Step 7: Pass diagnostics into formatter**

In the `risk` object passed to `formatTelegramRiskReport`, after `unrealizedToRealizedRatio,`, add:

```ts
          topInventoryDecisions,
          timeInNonOkStatusMs,
          riskTrajectory,
```

- [ ] **Step 8: Run tests and build**

Run:

```bash
npm test -- tests/reporting/telegram-risk-report.test.ts --runInBand
npm run build
```

Expected: both PASS.

- [ ] **Step 9: Commit Task 4**

Run:

```bash
git add src/run-paper.ts tests/reporting/telegram-risk-report.test.ts
git commit -m "$(cat <<'EOF'
feat(reporting): wire paper risk diagnostics

Track top inventory usage, risk-state transitions, reduce-only changes, and non-OK status duration across Telegram report intervals without changing trading behavior.

Co-Authored-By: OpenClaude (gpt-5.5) <openclaude@gitlawb.com>
EOF
)"
```

---

### Task 5: Regression verification and integration adjustments

**Files:**
- Modify if needed: `tests/integration/risk-gated-paper-report.test.ts`
- Modify if needed: `src/reporting/telegram-risk-report.ts`
- Modify if needed: `src/run-paper.ts`

- [ ] **Step 1: Run targeted reporting/risk suites**

Run:

```bash
npm test -- tests/reporting/telegram-risk-report.test.ts tests/risk/strategy-risk-manager.test.ts tests/integration/risk-gated-paper-report.test.ts --runInBand
```

Expected: PASS. If the integration test fails only because it expects the old static Action text or old report shape, update the expected strings to include the new fields and status-aware action. Do not change trading behavior to satisfy reporting tests.

- [ ] **Step 2: Run full test suite**

Run:

```bash
npm test -- --runInBand
```

Expected: PASS.

- [ ] **Step 3: Run TypeScript build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Inspect git diff for scope**

Run:

```bash
git diff --stat HEAD~4..HEAD
git status --short
```

Expected: only reporting tests, `src/reporting/telegram-risk-report.ts`, and `src/run-paper.ts` changed since implementation started. Working tree should be clean after commits.

- [ ] **Step 5: Commit any integration-only fixes if needed**

If Step 1 required integration test updates, run:

```bash
git add tests/integration/risk-gated-paper-report.test.ts src/reporting/telegram-risk-report.ts src/run-paper.ts
git commit -m "$(cat <<'EOF'
test(reporting): update risk report regression coverage

Align report regression expectations with the new risk visibility fields while preserving trading behavior.

Co-Authored-By: OpenClaude (gpt-5.5) <openclaude@gitlawb.com>
EOF
)"
```

If no files changed in Step 1, skip this commit.

---

## Self-Review

- Spec coverage:
  - PnL excluding rebates is implemented in Task 1.
  - Top inventory markets are implemented in Task 2 and wired in Task 4.
  - Dynamic action is implemented in Task 1.
  - Time in non-OK status is implemented in Tasks 3 and 4.
  - Risk trajectory is implemented in Tasks 3 and 4.
  - Safe fallbacks are covered in Tasks 2 and 3.
  - Regression verification is covered in Task 5.
- Placeholder scan: no `TBD`, `TODO`, or unspecified edge-case steps remain.
- Type consistency: `RiskTrajectorySnapshot`, `topInventoryDecisions`, `timeInNonOkStatusMs`, and `riskTrajectory` are defined before use and remain optional on report input.
