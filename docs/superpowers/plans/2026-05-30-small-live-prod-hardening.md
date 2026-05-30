# Small Live Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `small_live` fail closed before production launch and notify Telegram when startup blockers are detected.

**Architecture:** Keep changes surgical. Extract startup/preflight behavior into small testable helpers, keep `run-small-live.ts` as orchestration, and patch `StrategyRunner`/`OrderRouter` only where live risk state is currently stale or incomplete.

**Tech Stack:** TypeScript, Jest, Node.js, existing Telegram notifier, Polymarket CLOB/Data API clients.

---

## File Structure

**Create:**
- `src/strategy/small-live-preflight.ts` — env validation, Telegram startup blocker alert, go/no-go adapter.
- `tests/strategy/small-live-preflight.test.ts` — focused tests for preflight and alert behavior.

**Modify:**
- `src/run-small-live.ts` — call preflight, require wallet reconciliation, startup cancel-all, non-zero shutdown on cancel failure.
- `src/strategy/small-live-runner.ts` — make `cancelAllLiveOrders()` return a structured result and throw helper where needed.
- `src/strategy/strategy-runner.ts` — stale NO book guard; clear cancelled local slot if live replacement submit fails after cancel.
- `src/execution/order-router.ts` — expose cancel/submit phase result for live cancel-replace.
- `.env.example` — remove duplicate `WALLET_ADDRESS` block.
- Existing tests under `tests/strategy/` and `tests/execution/` — add regression coverage.

---

## Task 1: Preflight env validation and Telegram alert

**Files:**
- Create: `src/strategy/small-live-preflight.ts`
- Create: `tests/strategy/small-live-preflight.test.ts`

- [ ] **Step 1: Write failing tests**
  - Test missing `WALLET_ADDRESS` creates a blocker.
  - Test invalid private key format creates a blocker.
  - Test Telegram alert is attempted when Telegram credentials exist.
  - Test Telegram alert is skipped when Telegram credentials are missing.

Run: `npm test -- tests/strategy/small-live-preflight.test.ts --runInBand`
Expected: FAIL because module does not exist.

- [ ] **Step 2: Implement minimal preflight module**
  - Export `validateSmallLiveStartupEnv(envConfig)` returning `{ ok, blockers }`.
  - Export `notifyStartupBlockers(blockers, envConfig, logger)`.
  - Do not throw from notification failures.

- [ ] **Step 3: Verify green**
Run: `npm test -- tests/strategy/small-live-preflight.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 4: Commit**
`git add src/strategy/small-live-preflight.ts tests/strategy/small-live-preflight.test.ts && git commit -m "fix(live): add small-live startup preflight alerts"`

---

## Task 2: Fail closed on reconciliation and startup open orders

**Files:**
- Modify: `src/strategy/small-live-runner.ts`
- Modify: `src/run-small-live.ts`
- Test: `tests/strategy/small-live-runner.test.ts`

- [ ] **Step 1: Write failing tests**
  - `cancelAllLiveOrders()` returns `{ total, failed, failedOrderIds }`.
  - Failed cancellation is visible to caller.
  - Startup orchestration helper refuses to continue when reconciliation fails.

Run: `npm test -- tests/strategy/small-live-runner.test.ts --runInBand`
Expected: FAIL on old `cancelAllLiveOrders()` return shape.

- [ ] **Step 2: Implement minimal cancellation result and startup fail-closed calls**
  - Return cancellation result from `cancelAllLiveOrders()`.
  - In `run-small-live.ts`, require `env.walletAddress` and successful `DataApiClient.fetchPositions()` before live loop.
  - Call startup `cancelAllLiveOrders()` before `userStream.connect()` and fail if `failed > 0`.

- [ ] **Step 3: Verify green**
Run: `npm test -- tests/strategy/small-live-runner.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 4: Commit**
`git add src/run-small-live.ts src/strategy/small-live-runner.ts tests/strategy/small-live-runner.test.ts && git commit -m "fix(live): fail closed before small-live startup"`

---

## Task 3: Strategy safety fixes

**Files:**
- Modify: `src/strategy/strategy-runner.ts`
- Modify: `src/execution/order-router.ts`
- Test: `tests/strategy/strategy-runner.test.ts`
- Test: `tests/execution/execution-modules.test.ts`

- [ ] **Step 1: Write failing tests**
  - Stale NO book cancels/skips market and does not submit live order.
  - Live cancel succeeds but replacement submit fails; next cycle does not repeatedly cancel the already-cancelled order before submitting.

Run: `npm test -- tests/strategy/strategy-runner.test.ts tests/execution/execution-modules.test.ts --runInBand`
Expected: FAIL on missing behavior.

- [ ] **Step 2: Implement minimal strategy/router changes**
  - Check `isBookStale(noBook.lastUpdateMs, config.staleOrderMaxAgeMs)` alongside YES.
  - Split live cancel and submit state so caller can clear local slot after confirmed cancel.

- [ ] **Step 3: Verify green**
Run: `npm test -- tests/strategy/strategy-runner.test.ts tests/execution/execution-modules.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 4: Commit**
`git add src/strategy/strategy-runner.ts src/execution/order-router.ts tests/strategy/strategy-runner.test.ts tests/execution/execution-modules.test.ts && git commit -m "fix(live): harden quote cancellation safety"`

---

## Task 4: Wire go/no-go and final docs cleanup

**Files:**
- Modify: `src/run-small-live.ts`
- Modify: `.env.example`
- Test: `tests/strategy/small-live-preflight.test.ts`
- Test: `tests/invariants/runtime.test.ts`

- [ ] **Step 1: Write failing tests**
  - Go/no-go blocker result is converted into startup blockers.
  - `.env.example` contains exactly one `WALLET_ADDRESS=` line.

Run: `npm test -- tests/strategy/small-live-preflight.test.ts tests/invariants/runtime.test.ts --runInBand`
Expected: FAIL before wiring/cleanup.

- [ ] **Step 2: Implement minimal wiring**
  - Add a small adapter around `evaluateSmallLiveGoNoGo()` in preflight.
  - Remove duplicate `WALLET_ADDRESS` block from `.env.example`.

- [ ] **Step 3: Verify full suite**
Run: `npm test -- --runInBand && npm run build && npm audit --omit=dev --audit-level=moderate`
Expected: tests/build PASS; audit may still report known CLOB transitive vulnerabilities if no compatible upgrade exists.

- [ ] **Step 4: Commit**
`git add src/run-small-live.ts src/strategy/small-live-preflight.ts tests/strategy/small-live-preflight.test.ts tests/invariants/runtime.test.ts .env.example && git commit -m "fix(live): wire small-live go-no-go gate"`
