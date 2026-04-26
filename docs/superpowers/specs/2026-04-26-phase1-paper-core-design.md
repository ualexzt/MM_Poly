# Phase 1: Paper Mode Core — Design Document

> **Status:** Approved for implementation  
> **Approach:** Bottom-Up (pure engines first, then orchestration)  
> **Tech Stack:** TypeScript, Node.js, Jest, native fetch

---

## 1. Goal

Build a fully operational **paper-mode** market-making strategy for Polymarket CLOB V2 that:

1. Discovers and filters eligible markets from Gamma API.
2. Computes fair prices, toxicity scores, and inventory skew.
3. Generates post-only quote candidates.
4. Simulates order lifecycle (submit → rest → fill → cancel) conservatively.
5. Attributes PnL by source (spread, estimated rebates, adverse selection, inventory MTM).
6. Writes structured decision traces for every quote decision.
7. Enforces kill switches, exposure limits, and stale-book guards.

**Explicitly out of scope for Phase 1:**
- WebSocket streaming (use polling via REST).
- Real order placement (shadow / small_live modes).
- GTD orders (GTC only).
- Aggressive inventory rebalancing.
- Daily report generation UI (log JSON lines instead).
- External signal integration (weight = 0.00 per spec).

---

## 2. Architecture

### 2.1 High-Level Data Flow

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Gamma Scanner  │────▶│ Market Selector │────▶│ Market Scorer   │
│  (REST polling) │     │ (hard filters)  │     │ (rank eligible) │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                        │
                                                        ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ Paper Simulator │◀────│ Quote Engine    │◀────│ Fair Price Eng. │
│ (fills/cancels) │     │ (bid/ask gen)   │     │ (microprice...) │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       ▲                       ▲
        │                       │                       │
        ▼                       │               ┌───────┴───────────┐
┌─────────────────┐             │               │ Toxicity Engine   │
│ PnL Attribution │◀────────────┘               │ Inventory Engine  │
│ Decision Trace  │                             └───────────────────┘
└─────────────────┘
```

### 2.2 Layer Rules

| Layer | Responsibility | Side Effects? |
|-------|----------------|---------------|
| **Engines** | Pure functions: price, toxicity, inventory, quote math | **No** |
| **Strategy** | Orchestration: runner, selector, config | Yes (logging, state updates) |
| **Simulation** | Paper execution: fill model, queue model | Yes (state updates) |
| **Accounting** | PnL tracking, trace writing | Yes (file/stdout output) |
| **Risk** | Guards: kill switches, exposure checks | Yes (cancels, disables) |
| **Data** | API clients with pluggable transport | Yes (network I/O) |

---

## 3. Module Breakdown

### 3.1 Engines (Pure Functions)

Each engine is a collection of pure functions with no external dependencies. They receive primitive inputs and return primitive outputs.

#### `src/engines/fair-price-engine.ts`

```typescript
export function computeFairPrice(inputs: {
  bestBid: number;
  bestAsk: number;
  bestBidSize: number;
  bestAskSize: number;
  lastTradeEma: number | null;
  complementMidpoint: number | null;
  weights: FairPriceWeights;
}): { fairPrice: number; microprice: number } | null;

export function computeMicroprice(bestBid: number, bestAsk: number, bidSize: number, askSize: number): number;

export function checkComplementConsistency(yesFair: number, noFair: number, toleranceCents: number): boolean;
```

**Behavior:** Returns `null` if either best side is missing. Checks `yesFair + noFair ≈ 1.0` within tolerance.

#### `src/engines/toxicity-engine.ts`

```typescript
export function computeToxicityScore(inputs: FlowStateSnapshot): number; // [0, 1]

export function getToxicityAction(score: number): ToxicityAction;

export function checkHardToxicityCancel(inputs: HardToxicityInputs): boolean;
```

**Behavior:** Normalized score. Hard cancels are independent boolean checks for immediate action.

#### `src/engines/inventory-engine.ts`

```typescript
export function computeInventoryState(inputs: InventoryInputs): InventoryState;

export function computeInventorySkew(inventoryPct: number, maxSkewCents: number, sensitivity: number): number;

export function getInventoryAction(state: InventoryState): InventoryAction;
```

**Behavior:** `tanh`-based skew. Hard limit blocks inventory-increasing orders.

#### `src/engines/quote-engine.ts`

```typescript
export function computeTargetHalfSpread(inputs: SpreadInputs): number;

export function computeQuoteSize(inputs: SizeInputs): number;

export function generateQuoteCandidates(inputs: QuoteEngineInputs): QuoteCandidate[];
```

**Behavior:** Applies reward-aware tightening, inventory widening, toxicity widening, post-only safety, tick rounding.

### 3.2 Strategy (Orchestration)

#### `src/strategy/config.ts`

Typed, validated configuration object matching spec section 19. All numeric limits are required (no optional defaults for risk params).

#### `src/strategy/market-selector.ts`

```typescript
export function filterEligibleMarkets(markets: MarketState[], config: MarketFilterConfig): MarketState[];
export function scoreMarkets(markets: MarketState[], config: ScoringConfig): ScoredMarket[];
```

#### `src/strategy/strategy-runner.ts`

Main loop (pseudo-code):

```typescript
for (const market of selectedMarkets) {
  const book = await data.getBook(market.conditionId);
  if (riskGuards.shouldSkip(market, book)) continue;

  const fair = fairPriceEngine.compute(...);
  const toxicity = toxicityEngine.compute(...);
  const inventory = inventoryEngine.compute(...);
  const quotes = quoteEngine.generate(...);

  for (const quote of quotes) {
    const trace = createTrace(quote, ...);
    if (mode === 'paper') {
      paperSimulator.submit(quote);
    }
    logger.writeTrace(trace);
  }
}
```

### 3.3 Simulation

#### `src/simulation/paper-execution-engine.ts`

```typescript
export class PaperExecutionEngine {
  submit(order: PaperOrder): void;
  cancel(orderId: string): void;
  onBookUpdate(book: BookState): FillEvent[];
  onTrade(trade: TradeEvent): FillEvent[];
  getOpenOrders(): PaperOrder[];
}
```

**Fill Model (conservative):**
- BUY fills only if observed trade price ≤ quote price.
- SELL fills only if observed trade price ≥ quote price.
- Queue: fill only after prior visible size at that level is consumed.
- Partial fills supported.
- Delayed cancel → stale fill possible.

#### `src/simulation/queue-model.ts`

```typescript
export function estimateQueuePosition(
  orderPrice: number,
  orderSide: 'BUY' | 'SELL',
  book: BookState,
  priorTrades: TradeEvent[]
): QueuePosition;
```

### 3.4 Accounting

#### `src/accounting/pnl-attribution.ts`

```typescript
export function computePnlBreakdown(state: StrategyState): StrategyPnlBreakdown;
```

Tracks: realized, unrealized, spread capture, estimated rebates, adverse selection, inventory MTM.

#### `src/accounting/decision-trace.ts`

```typescript
export function createTrace(inputs: TraceInputs): QuoteDecisionTrace;
export function serializeTrace(trace: QuoteDecisionTrace): string; // JSON
```

### 3.5 Risk

#### `src/risk/kill-switch.ts`

```typescript
export class KillSwitch {
  check(wsStatus: WsStatus, apiErrors: ApiErrorWindow, drawdown: Drawdown): KillSwitchState;
}
```

States: `OK`, `CANCEL_ALL`, `DISABLE_STRATEGY`.

#### `src/risk/exposure-limits.ts`

```typescript
export function checkExposureLimits(inventory: InventoryState, config: RiskConfig): RiskCheckResult;
```

#### `src/risk/stale-book-guard.ts`

```typescript
export function isBookStale(book: BookState, maxAgeMs: number): boolean;
```

### 3.6 Data (Abstracted Transport)

#### `src/data/gamma-market-scanner.ts`

```typescript
export interface MarketScanner {
  fetchMarkets(): Promise<MarketState[]>;
}
```

Two implementations:
- `GammaApiScanner` — real Gamma API calls.
- `FixtureScanner` — loads from `fixtures/markets.json` for tests.

#### `src/data/clob-orderbook-client.ts`

```typescript
export interface OrderbookClient {
  fetchBook(conditionId: string, tokenId: string): Promise<BookState>;
}
```

---

## 4. Interfaces & Types

All TypeScript interfaces from spec sections 6, 14, 15 are centralized in:

- `src/types/market.ts` — MarketState, RewardConfig
- `src/types/book.ts` — BookState, BookLevel
- `src/types/flow.ts` — FlowState
- `src/types/inventory.ts` — InventoryState
- `src/types/quote.ts` — QuoteCandidate
- `src/types/accounting.ts` — StrategyPnlBreakdown, QuoteDecisionTrace

---

## 5. Error Handling

| Error | Handling |
|-------|----------|
| API timeout | Log, retry once, skip cycle |
| Book fetch fail | Mark book stale, skip market |
| Invalid tick size | Cancel market quotes, log error |
| Negative inventory | Log fatal, disable strategy |
| Complement inconsistency | Widen quotes or skip market |

---

## 6. Testing Strategy

### 6.1 Unit Tests (Jest)

Every engine gets a dedicated test file per spec section 21.

| Module | Test File | Key Cases |
|--------|-----------|-----------|
| Fair Price | `tests/engines/fair-price-engine.test.ts` | midpoint, microprice, complement, missing side, consistency fail |
| Toxicity | `tests/engines/toxicity-engine.test.ts` | low/medium/high/critical levels, hard cancels |
| Inventory | `tests/engines/inventory-engine.test.ts` | soft/hard limits, skew direction, sell guard |
| Quote | `tests/engines/quote-engine.test.ts` | post-only safety, tick rounding, size rules, spread bounds |
| Paper Simulator | `tests/simulation/paper-execution-engine.test.ts` | fill conditions, queue, partial fills, stale cancel |

**TDD Rule:** Write failing test → watch it fail → implement → watch it pass → refactor.

### 6.2 Integration Tests

One integration test file: `tests/integration/paper-pipeline.test.ts`

Tests the full pipeline with `FixtureScanner` and mocked `OrderbookClient`:
1. Load markets → select eligible.
2. Fetch book → compute fair + toxicity + inventory.
3. Generate quotes → paper submit.
4. Simulate trade → verify fill.
5. Check PnL + trace written.

### 6.3 Runtime Invariant Tests

`tests/invariants/runtime.test.ts` encodes spec section 23 invariants as assertions against strategy state.

---

## 7. Acceptance Criteria (Phase 1)

Before Phase 2 starts, Phase 1 must satisfy:

- [ ] All unit tests for engines pass.
- [ ] Paper pipeline integration test passes.
- [ ] Runtime invariant tests pass.
- [ ] Decision traces are written for every quote cycle.
- [ ] No real orders are ever submitted (paper mode enforced).
- [ ] Kill switches cancel all paper orders on trigger.
- [ ] Exposure limits block quotes that would breach hard limits.
- [ ] Stale books are rejected within 2000ms threshold.
- [ ] PnL is computed both with and without estimated rebates.

---

## 8. File Structure

```
src/
  types/
    market.ts
    book.ts
    flow.ts
    inventory.ts
    quote.ts
    accounting.ts
    config.ts
  engines/
    fair-price-engine.ts
    toxicity-engine.ts
    inventory-engine.ts
    quote-engine.ts
    index.ts
  strategy/
    config.ts
    market-selector.ts
    strategy-runner.ts
  simulation/
    paper-execution-engine.ts
    queue-model.ts
  accounting/
    pnl-attribution.ts
    decision-trace.ts
    fill-classifier.ts
  risk/
    kill-switch.ts
    exposure-limits.ts
    stale-book-guard.ts
  data/
    gamma-market-scanner.ts
    clob-orderbook-client.ts
    fixtures/
      markets.json
      orderbook.json
  utils/
    math.ts          // tick rounding, tanh, etc.
    logger.ts        // structured JSON logger

tests/
  engines/
    fair-price-engine.test.ts
    toxicity-engine.test.ts
    inventory-engine.test.ts
    quote-engine.test.ts
  simulation/
    paper-execution-engine.test.ts
    queue-model.test.ts
  integration/
    paper-pipeline.test.ts
  invariants/
    runtime.test.ts
```

---

## 9. Dependencies

```json
{
  "typescript": "^5.x",
  "jest": "^29.x",
  "ts-jest": "^29.x",
  "@types/jest": "^29.x",
  "@types/node": "^20.x"
}
```

No external trading SDKs in Phase 1. HTTP calls use native `fetch`.

---

## 10. Notes for Implementer

1. **Engines first.** Do not touch `strategy-runner.ts` until all four engines have passing tests.
2. **Paper simulator must be conservative.** Do not overstate edge with optimistic fills.
3. **Decision traces are mandatory.** Even skipped quotes must have a trace with reason.
4. **Config is source of truth.** No magic numbers outside `config.ts`.
5. **Kill switches are synchronous.** They must halt quote generation immediately, not asynchronously.
