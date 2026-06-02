# Pair-Cost Hedge-Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-safe pure `pair_cost` hedge-completion engine that only completes profitable YES/NO pairs by default.

**Architecture:** Add focused pure engine modules for lot-level inventory pairing, executable ask-walk pricing, hedge/probe/reduce-only decisions, and active-order lifecycle state. Keep existing scanner tests working; do not wire live execution or place orders.

**Tech Stack:** TypeScript, Jest, existing `BookState`/`BookLevel` market data types.

---

## File Structure

- Create `src/engines/pair-cost-types.ts`: strategy config defaults, states, skip reasons, inventory/order/decision types.
- Create `src/engines/pair-cost-inventory.ts`: deterministic lot-level inventory rebuild and selected lot average cost helper.
- Create `src/engines/executable-price.ts`: executable buy price calculation from `BookState.asks`.
- Create `src/engines/pair-cost-strategy.ts`: pure per-tick decision engine and active-order partial-fill/cancel-timeout helper.
- Create `tests/engines/pair-cost-inventory.test.ts`: lot pairing and no-average tests.
- Create `tests/engines/executable-price.test.ts`: ask-walk executable price tests.
- Create `tests/engines/pair-cost-strategy.test.ts`: hedge decisions, risk guard, probe, stale book, time-to-close, active order, partial fill, reduce-only tests.
- Modify `src/engines/pair-cost-scanner.ts` only if needed to preserve compatibility with old tests; prefer leaving it intact.

## Tasks

### Task 1: Inventory types and lot-level pairing

**Files:**
- Create: `src/engines/pair-cost-types.ts`
- Create: `src/engines/pair-cost-inventory.ts`
- Test: `tests/engines/pair-cost-inventory.test.ts`

- [ ] Write failing tests for the required lot example and average-cost hiding regression.
- [ ] Run `npm test -- tests/engines/pair-cost-inventory.test.ts --runInBand`; expect module-not-found failure.
- [ ] Implement exported types plus `DEFAULT_PAIR_COST_STRATEGY_CONFIG`, `rebuildPairCostInventoryState`, and `averageCostOfLots`.
- [ ] Run the focused test; expect PASS.

### Task 2: Executable price calculation

**Files:**
- Create: `src/engines/executable-price.ts`
- Test: `tests/engines/executable-price.test.ts`

- [ ] Write failing ask-walk test for asks 0.43x2, 0.44x3, 0.46x10 and qty 5.
- [ ] Run focused test; expect module-not-found failure.
- [ ] Implement `getExecutableBuyPrice(orderbook, side, qty)` using sorted asks and weighted average.
- [ ] Run focused test; expect PASS.

### Task 3: Hedge-completion decision engine

**Files:**
- Create: `src/engines/pair-cost-strategy.ts`
- Test: `tests/engines/pair-cost-strategy.test.ts`

- [ ] Write failing tests for disabled strategy, BUY NO to hedge YES, expensive hedge rejection, BUY YES to hedge NO, same-side accumulation prevention, probe disabled, probe exposure cap, stale book, time-to-close, reduce-only timeout, active order exists, and partial fill cancel timeout.
- [ ] Run focused test; expect module-not-found failure.
- [ ] Implement `decidePairCostStrategyTick` returning structured `PairCostDecision` with required log fields and explicit skip reasons.
- [ ] Implement `applyPairCostFillAndManageOrder` for partial fill inventory rebuild and timeout cancellation.
- [ ] Run focused test; expect PASS.

### Task 4: Verification, review, commit, push

**Files:**
- All created files above.

- [ ] Run `npm test -- --runInBand`; expect all Jest suites PASS.
- [ ] Run `npm run build`; expect TypeScript compile PASS.
- [ ] Run Docker verification adapted to this Node project: `docker compose run --rm app npm test -- --runInBand` if compose service exists; otherwise inspect compose services and use the matching Node service. If Docker is unavailable or no compose file exists, report exact blocker.
- [ ] Self-review against SPEC section 18 and fix any gaps before finalizing.
- [ ] Commit implementation and push branch.
