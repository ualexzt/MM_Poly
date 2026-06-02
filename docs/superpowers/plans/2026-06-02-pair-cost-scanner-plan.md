# Pair-Cost Scanner Implementation Plan

**Goal:** Implement YES/NO pair-cost scanner with TDD. Paper mode only — log opportunities, no orders.

## Tasks

### Task 1: Pure Engine — pair-cost-scanner
- [x] Write failing tests for `calculatePairCost` and `scanPairCostOpportunities`
- [x] Implement engine to pass tests
- [x] Verify: all tests green

### Task 2: Runner — pair-cost-runner
- [x] Write failing tests for `fetchPairOrderbooks` and `runPairCostScanCycle`
- [x] Implement runner with injected clients
- [x] Verify: all tests green

### Task 3: CLI Entrypoint — run-pair-cost
- [x] Write `src/run-pair-cost.ts` CLI script
- [x] Add `start:pair-cost` to package.json scripts
- [x] Verify: `npm run build` passes

### Task 4: Integration Verification
- [x] Run full test suite
- [x] Verify no legacy references
- [x] Commit and push
