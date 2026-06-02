# Accumulator Strategy Implementation Plan

**Goal:** Implement full Gabagool-style accumulator + equalizer strategy with TDD. Paper mode first.

## Tasks

### Task 1: Accumulator Engine (pure)
- [x] Write failing tests for `decideAccumulatorEntry`
- [x] Implement accumulator logic
- [x] Verify: all tests green

### Task 2: Equalizer Engine (pure)
- [x] Write failing tests for `decideEqualizer`
- [x] Implement equalizer logic
- [x] Verify: all tests green

### Task 3: Position Tracker
- [x] Write failing tests for PositionTracker
- [x] Implement tracker with fill updates
- [x] Verify: all tests green

### Task 4: Risk Engine (pure)
- [x] Write failing tests for risk checks
- [x] Implement risk engine
- [x] Verify: all tests green

### Task 5: Order Manager
- [x] Write failing tests with mock CLOB client
- [x] Implement order placement/cancellation
- [x] Verify: all tests green

### Task 6: Accumulator Runner
- [x] Write failing integration test with all mocks
- [x] Implement runner loop
- [x] Verify: all tests green

### Task 7: CLI Entrypoint
- [x] Write `src/run-accumulator.ts`
- [x] Add `start:accumulator` to package.json
- [x] Verify: build passes, full test suite green

### Task 8: Deploy
- [ ] Build Docker image
- [ ] Deploy to production server
- [ ] Start paper mode daemon
