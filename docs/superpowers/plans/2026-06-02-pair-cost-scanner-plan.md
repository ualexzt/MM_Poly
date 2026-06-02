# Pair-Cost Scanner Implementation Plan

**Goal:** Implement YES/NO pair-cost scanner with TDD. Paper mode only — log opportunities, no orders.

## Tasks

### Task 1: Pure Engine — pair-cost-scanner
- [ ] Write failing tests for `calculatePairCost` and `scanPairCostOpportunities`
- [ ] Implement engine to pass tests
- [ ] Verify: all tests green

### Task 2: Runner — pair-cost-runner
- [ ] Write failing tests for `fetchPairOrderbooks` and `runPairCostScanCycle`
- [ ] Implement runner with injected clients
- [ ] Verify: all tests green

### Task 3: CLI Entrypoint — run-pair-cost
- [ ] Write `src/run-pair-cost.ts` CLI script
- [ ] Add `start:pair-cost` to package.json scripts
- [ ] Verify: `npm run build` passes

### Task 4: Integration Verification
- [ ] Run full test suite
- [ ] Verify no legacy references
- [ ] Commit and push
