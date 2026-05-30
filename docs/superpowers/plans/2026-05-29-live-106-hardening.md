# Live 1.06 Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all critical and high vulnerabilities found in deep code audit before live trading launch on 2026-06-01. Focus on reliability, correct data sources, and paper-live parity.

**Architecture:** All changes stay within existing module boundaries. `src/data/` gets a new Data API client for positions. `src/strategy/` and `src/run-paper.ts` get startup reconciliation. Risk/simulation layers get correctness fixes. No new abstractions beyond what's needed.

**Tech Stack:** TypeScript, Jest, Node.js fetch with AbortController, Polymarket Data API (`data-api.polymarket.com`), existing CLOB client v2.

---

## File Structure

**Create:**
- `src/data/data-api-client.ts` — Polymarket Data API client (positions, balance)
- `tests/data/data-api-client.test.ts` — Tests for Data API client

**Modify:**
- `src/data/clob-orderbook-client.ts` — Add HTTP timeout to fetchBook
- `src/data/gamma-market-scanner.ts` — Add HTTP timeout to fetchMarkets
- `src/run-paper.ts` — Graceful shutdown, real kill switch data, real toxicity, position reconciliation
- `src/run-small-live.ts` — Graceful shutdown, position reconciliation on startup
- `src/strategy/strategy-runner.ts` — ActiveOrders cleanup, timeout to bookClient calls
- `src/strategy/small-live-runner.ts` — Position reconciliation wiring
- `src/data/ws-market-stream.ts` — Exponential backoff reconnect
- `src/data/ws-user-stream.ts` — Exponential backoff reconnect
- `src/execution/order-router.ts` — cancelAll error handling
- `src/engines/inventory-tracker.ts` — Add `loadPositions()` method
- `src/config/env.ts` — Add walletAddress env var

**Test:**
- `tests/data/data-api-client.test.ts`
- `tests/data/clob-orderbook-client.test.ts` (if exists, else create)
- `tests/engines/inventory-tracker.test.ts`
- `tests/strategy/strategy-runner.test.ts`

---

## Task 1: HTTP Timeouts on All Fetch Calls

**Problem:** `ClobApiClient.fetchBook()` and `GammaApiScanner.fetchMarkets()` use bare `fetch()` with no timeout. A hung API blocks the strategy loop forever.

**Files:**
- Modify: `src/data/clob-orderbook-client.ts`
- Modify: `src/data/gamma-market-scanner.ts`

- [ ] **Step 1: Add timeout helper to clob-orderbook-client.ts**

Add at the top of `src/data/clob-orderbook-client.ts`:

```ts
const FETCH_TIMEOUT_MS = 10_000;

async function fetchWithTimeout(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 2: Replace fetch in ClobApiClient.fetchBook**

In `ClobApiClient.fetchBook()`, replace:
```ts
const res = await fetch(`${this.baseUrl}/book?token_id=${tokenId}`);
```
with:
```ts
const res = await fetchWithTimeout(`${this.baseUrl}/book?token_id=${tokenId}`);
```

- [ ] **Step 3: Add same timeout to GammaApiScanner.fetchMarkets**

In `src/data/gamma-market-scanner.ts`, add the same `fetchWithTimeout` helper and replace:
```ts
const res = await fetch(
  `${this.baseUrl}/markets?active=true&closed=false&limit=50`
);
```
with:
```ts
const res = await fetchWithTimeout(
  `${this.baseUrl}/markets?active=true&closed=false&limit=50`
);
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: All 155 tests PASS (no behavior change, only timeout added)

- [ ] **Step 5: Commit**

```bash
git add src/data/clob-orderbook-client.ts src/data/gamma-market-scanner.ts
git commit -m "fix(data): add 10s HTTP timeout to fetchBook and fetchMarkets"
```

---

## Task 2: Data API Client for Positions

**Problem:** Polymarket CLOB V2 removed `getPositions()`. Positions now come from the public Data API. We need a client to query positions on startup and for periodic reconciliation.

**Reference:** `GET https://data-api.polymarket.com/positions?user=<wallet>` — no auth required.

**Files:**
- Create: `src/data/data-api-client.ts`
- Create: `tests/data/data-api-client.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/data/data-api-client.test.ts`:

```ts
import { DataApiClient, PolymarketPosition } from '../src/data/data-api-client';

describe('DataApiClient', () => {
  describe('mapPositions', () => {
    it('maps raw API response to PolymarketPosition array', () => {
      const raw = [
        {
          asset: 'token-yes-1',
          conditionId: 'cond-1',
          size: '50',
          avgPrice: '0.45',
          curPrice: '0.52',
          initialValue: '22.5',
          currentValue: '26',
          cashPnl: '3.5',
          percentPnl: '15.56',
          realizedPnl: '0',
          outcome: 'Yes',
          outcomeIndex: 0,
          title: 'Will X happen?',
          slug: 'will-x-happen',
          proxyWallet: '0xabc',
          endDate: '2026-12-31',
          redeemable: false,
          negativeRisk: false,
        },
      ];

      const client = new DataApiClient('https://data-api.polymarket.com', '0xabc');
      const positions = client.mapRawPositions(raw);

      expect(positions).toHaveLength(1);
      expect(positions[0].tokenId).toBe('token-yes-1');
      expect(positions[0].conditionId).toBe('cond-1');
      expect(positions[0].size).toBe(50);
      expect(positions[0].avgPrice).toBe(0.45);
      expect(positions[0].curPrice).toBe(0.52);
      expect(positions[0].cashPnl).toBe(3.5);
      expect(positions[0].realizedPnl).toBe(0);
      expect(positions[0].outcome).toBe('Yes');
    });

    it('filters out zero-size positions', () => {
      const raw = [
        { asset: 't1', conditionId: 'c1', size: '0', avgPrice: '0', curPrice: '0', initialValue: '0', currentValue: '0', cashPnl: '0', percentPnl: '0', realizedPnl: '0', outcome: 'Yes', outcomeIndex: 0, title: '', slug: '', proxyWallet: '0x', endDate: '', redeemable: false, negativeRisk: false },
        { asset: 't2', conditionId: 'c2', size: '10', avgPrice: '0.5', curPrice: '0.6', initialValue: '5', currentValue: '6', cashPnl: '1', percentPnl: '20', realizedPnl: '0', outcome: 'No', outcomeIndex: 1, title: '', slug: '', proxyWallet: '0x', endDate: '', redeemable: false, negativeRisk: false },
      ];

      const client = new DataApiClient('https://data-api.polymarket.com', '0xabc');
      const positions = client.mapRawPositions(raw);

      expect(positions).toHaveLength(1);
      expect(positions[0].tokenId).toBe('t2');
    });

    it('handles empty array', () => {
      const client = new DataApiClient('https://data-api.polymarket.com', '0xabc');
      expect(client.mapRawPositions([])).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/data/data-api-client.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement DataApiClient**

Create `src/data/data-api-client.ts`:

```ts
const FETCH_TIMEOUT_MS = 10_000;

async function fetchWithTimeout(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export interface PolymarketPosition {
  tokenId: string;
  conditionId: string;
  size: number;
  avgPrice: number;
  curPrice: number;
  initialValue: number;
  currentValue: number;
  cashPnl: number;
  realizedPnl: number;
  outcome: string;
  title: string;
  slug: string;
  redeemable: boolean;
}

interface RawPosition {
  asset: string;
  conditionId: string;
  size: string;
  avgPrice: string;
  curPrice: string;
  initialValue: string;
  currentValue: string;
  cashPnl: string;
  percentPnl: string;
  realizedPnl: string;
  outcome: string;
  outcomeIndex: number;
  title: string;
  slug: string;
  proxyWallet: string;
  endDate: string;
  redeemable: boolean;
  negativeRisk: boolean;
}

export class DataApiClient {
  private baseUrl: string;
  private walletAddress: string;

  constructor(baseUrl: string, walletAddress: string) {
    this.baseUrl = baseUrl;
    this.walletAddress = walletAddress;
  }

  /**
   * Map raw API positions to typed PolymarketPosition array.
   * Exported for testing.
   */
  mapRawPositions(raw: any[]): PolymarketPosition[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((p: any) => parseFloat(p.size) > 0)
      .map((p: any) => ({
        tokenId: p.asset,
        conditionId: p.conditionId,
        size: parseFloat(p.size),
        avgPrice: parseFloat(p.avgPrice),
        curPrice: parseFloat(p.curPrice),
        initialValue: parseFloat(p.initialValue),
        currentValue: parseFloat(p.currentValue),
        cashPnl: parseFloat(p.cashPnl),
        realizedPnl: parseFloat(p.realizedPnl),
        outcome: p.outcome,
        title: p.title || '',
        slug: p.slug || '',
        redeemable: p.redeemable === true,
      }));
  }

  /**
   * Fetch current positions from Polymarket Data API.
   * No authentication required.
   */
  async fetchPositions(): Promise<PolymarketPosition[]> {
    const url = `${this.baseUrl}/positions?user=${this.walletAddress}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) {
      throw new Error(`Data API positions error: ${res.status}`);
    }
    const data = await res.json();
    return this.mapRawPositions(data);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/data/data-api-client.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/data/data-api-client.ts tests/data/data-api-client.test.ts
git commit -m "feat(data): add DataApiClient for Polymarket position queries"
```

---

## Task 3: InventoryTracker.loadPositions() for Startup Reconciliation

**Problem:** On restart, InventoryTracker starts empty. We need to seed it from Data API positions.

**Files:**
- Modify: `src/engines/inventory-tracker.ts`
- Modify: `tests/engines/inventory-tracker.test.ts` (or wherever inventory tracker tests live)

- [ ] **Step 1: Write failing test**

Add to inventory tracker tests:

```ts
test('loadPositions seeds inventory from external position data', () => {
  const tracker = new InventoryTracker(defaultConfig.inventory, 100);

  tracker.loadPositions([
    { tokenId: 'yes-token-1', conditionId: 'cond-1', size: 50, avgPrice: 0.45, side: 'BUY' },
    { tokenId: 'no-token-1', conditionId: 'cond-1', size: 20, avgPrice: 0.55, side: 'BUY' },
  ]);

  const pos1 = tracker.getPosition('cond-1', 'yes-token-1');
  expect(pos1.yesTokens).toBe(50);
  expect(pos1.avgEntryPrice).toBeCloseTo(0.45);

  const pos2 = tracker.getPosition('cond-1', 'no-token-1');
  expect(pos2.noTokens).toBe(20);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --testPathPattern inventory`
Expected: FAIL — loadPositions not defined

- [ ] **Step 3: Implement loadPositions**

Add to `InventoryTracker` class in `src/engines/inventory-tracker.ts`:

```ts
interface ExternalPosition {
  tokenId: string;
  conditionId: string;
  size: number;
  avgPrice: number;
  side: 'BUY' | 'SELL';
}

loadPositions(positions: ExternalPosition[]): void {
  for (const pos of positions) {
    if (pos.size <= 0) continue;
    const key = this.getKey(pos.conditionId, pos.tokenId);
    const existing = this.positions.get(key);
    if (existing) {
      // Merge: add to existing position
      if (pos.side === 'BUY') {
        const totalSize = existing.yesTokens + pos.size;
        existing.avgEntryPrice = totalSize > 0
          ? (existing.avgEntryPrice * existing.yesTokens + pos.avgPrice * pos.size) / totalSize
          : pos.avgPrice;
        existing.yesTokens = totalSize;
      }
    } else {
      this.positions.set(key, {
        conditionId: pos.conditionId,
        tokenId: pos.tokenId,
        yesTokens: pos.side === 'BUY' ? pos.size : 0,
        noTokens: pos.side === 'SELL' ? pos.size : 0,
        avgEntryPrice: pos.avgPrice,
        realizedPnl: 0,
      });
    }
  }
}
```

(Adjust method body to match actual InventoryPosition interface in the codebase.)

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/engines/inventory-tracker.ts tests/engines/inventory-tracker.test.ts
git commit -m "feat(engine): add loadPositions to InventoryTracker for startup reconciliation"
```

---

## Task 4: Wire Position Reconciliation into run-small-live.ts

**Problem:** Live mode starts with empty inventory. After restart, bot doesn't know about existing positions.

**Files:**
- Modify: `src/run-small-live.ts`
- Modify: `src/strategy/small-live-runner.ts` (if needed)
- Modify: `src/config/env.ts` — add walletAddress

- [ ] **Step 1: Add WALLET_ADDRESS to env config**

In `src/config/env.ts`, add to `EnvConfig` interface:
```ts
walletAddress?: string;
```
And to the export:
```ts
walletAddress: process.env.WALLET_ADDRESS,
```

- [ ] **Step 2: Add Data API client initialization to run-small-live.ts**

After `const liveSubmitter = new LiveOrderSubmitter(clobClient as any);`, add:

```ts
// Position reconciliation from Polymarket Data API
if (env.walletAddress) {
  const dataApi = new DataApiClient('https://data-api.polymarket.com', env.walletAddress);
  try {
    const positions = await dataApi.fetchPositions();
    logger.info('Loaded positions from Data API', { count: positions.length });
    for (const pos of positions) {
      runner.getInventory().loadPositions([{
        tokenId: pos.tokenId,
        conditionId: pos.conditionId,
        size: pos.size,
        avgPrice: pos.avgPrice,
        side: pos.outcome === 'Yes' ? 'BUY' : 'BUY', // Data API always shows holdings as positive size
      }]);
    }
  } catch (err) {
    logger.error('Failed to load positions from Data API', { error: String(err) });
    // Non-fatal: continue with empty inventory, WS fills will rebuild it
  }
} else {
  logger.warn('WALLET_ADDRESS not set — skipping position reconciliation');
}
```

- [ ] **Step 3: Add getInventory() accessor to StrategyRunner if missing**

In `src/strategy/strategy-runner.ts`, add:
```ts
getInventory(): InventoryTracker {
  return this.inventory;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/config/env.ts src/run-small-live.ts src/strategy/strategy-runner.ts
git commit -m "feat(live): reconcile positions from Data API on startup"
```

---

## Task 5: Wire Position Reconciliation into run-paper.ts

**Paper mode also benefits from knowing existing positions for accurate PnL tracking.**

**Files:**
- Modify: `src/run-paper.ts`

- [ ] **Step 1: Add Data API position load at startup**

After `const paperEngine = new PaperExecutionEngine(...)` block, add:

```ts
// Load existing positions from Data API for accurate paper tracking
if (env.walletAddress) {
  const dataApi = new DataApiClient('https://data-api.polymarket.com', env.walletAddress);
  try {
    const positions = await dataApi.fetchPositions();
    logger.info('Loaded positions from Data API for paper tracking', { count: positions.length });
    for (const pos of positions) {
      pnlTracker.onFill({
        orderId: `startup-${pos.tokenId}`,
        tokenId: pos.tokenId,
        side: 'BUY',
        filledPrice: pos.avgPrice,
        filledSize: pos.size,
        remainingSize: 0,
      }, pos.curPrice);
    }
  } catch (err) {
    logger.warn('Could not load positions from Data API', { error: String(err) });
  }
}
```

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/run-paper.ts
git commit -m "feat(paper): load existing positions from Data API on startup"
```

---

## Task 6: Graceful Shutdown for Paper and Live Modes

**Problem:** No SIGINT/SIGTERM handlers in run-paper.ts. Docker stop kills process without cancelling orders.

**Files:**
- Modify: `src/run-paper.ts`
- Modify: `src/run-small-live.ts` (verify existing shutdown is correct)

- [ ] **Step 1: Add shutdown handler to run-paper.ts**

At the end of `main()` in `run-paper.ts`, before the closing `}`, add:

```ts
// Graceful shutdown
let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.warn('Paper shutdown requested; cancelling all orders');
  for (const order of paperEngine.getOpenOrders()) {
    paperEngine.cancel(order.id);
  }
  ws.disconnect();
  process.exit(0);
};

process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });
```

- [ ] **Step 2: Verify run-small-live.ts shutdown**

Confirm `run-small-live.ts` already has proper shutdown (it does — verified in audit). No changes needed.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/run-paper.ts
git commit -m "fix(paper): add graceful shutdown on SIGINT/SIGTERM"
```

---

## Task 7: Fix Kill Switch Hardcoded Values in Paper Mode

**Problem:** `run-paper.ts` passes `errorsLast60s: 0, totalLast60s: 100` to kill switch — API error check never triggers.

**Files:**
- Modify: `src/run-paper.ts`

- [ ] **Step 1: Track real WS and API errors**

Add counters near the top of `main()`:
```ts
let wsErrorsLast60s = 0;
let apiCallsLast60s = 0;
let apiErrorsLast60s = 0;
const errorTimestamps: number[] = [];
const apiCallTimestamps: number[] = [];
const apiErrorTimestamps: number[] = [];
```

- [ ] **Step 2: Update error tracking in WS callback**

In the WS error handler:
```ts
(err) => {
  errorsCount += 1;
  wsErrorsLast60s++;
  errorTimestamps.push(Date.now());
  logger.error('WS error', { error: err.message });
}
```

- [ ] **Step 3: Track API calls in evaluateMarket**

Wrap book fetch calls with tracking:
```ts
apiCallsLast60s++;
apiCallTimestamps.push(Date.now());
```

On fetch error:
```ts
apiErrorsLast60s++;
apiErrorTimestamps.push(Date.now());
```

- [ ] **Step 4: Clean old timestamps and pass real data to kill switch**

Before the kill switch check in `evaluateMarket`:
```ts
const now60s = Date.now() - 60_000;
while (errorTimestamps.length && errorTimestamps[0] < now60s) errorTimestamps.shift();
while (apiCallTimestamps.length && apiCallTimestamps[0] < now60s) apiCallTimestamps.shift();
while (apiErrorTimestamps.length && apiErrorTimestamps[0] < now60s) apiErrorTimestamps.shift();

const ks = killSwitch.check(
  { connected: ws.isConnected(), disconnectedAt: null },
  { errorsLast60s: apiErrorTimestamps.length, totalLast60s: apiCallTimestamps.length },
  { currentDrawdownPct: 0, currentDrawdownUsd: computeCurrentDrawdownUsd() }
);
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/run-paper.ts
git commit -m "fix(paper): pass real API error rates to kill switch"
```

---

## Task 8: Exponential Backoff for WebSocket Reconnects

**Problem:** Fixed 5s reconnect delay causes thundering herd when server restarts.

**Files:**
- Modify: `src/data/ws-market-stream.ts`
- Modify: `src/data/ws-user-stream.ts`

- [ ] **Step 1: Add backoff to WsMarketStream**

Replace the reconnect logic in `ws-market-stream.ts`:

```ts
// Add class fields:
private reconnectAttempt = 0;
private readonly MAX_RECONNECT_DELAY_MS = 60_000;
private readonly BASE_RECONNECT_DELAY_MS = 1_000;
```

In the `close` handler, replace:
```ts
this.reconnectTimer = setTimeout(() => this.connect(this.tokenIds), 5000);
```
with:
```ts
const delay = Math.min(
  this.BASE_RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempt) + Math.random() * 1000,
  this.MAX_RECONNECT_DELAY_MS
);
this.reconnectAttempt++;
console.log(`[WS] Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempt})...`);
this.reconnectTimer = setTimeout(() => this.connect(this.tokenIds), delay);
```

In the `open` handler, reset the counter:
```ts
this.reconnectAttempt = 0;
```

- [ ] **Step 2: Add same backoff to WsUserStream**

Same pattern in `ws-user-stream.ts`:

```ts
private reconnectAttempt = 0;
private readonly MAX_RECONNECT_DELAY_MS = 60_000;
private readonly BASE_RECONNECT_DELAY_MS = 1_000;
```

Replace 3000ms fixed delay with exponential backoff + jitter.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/data/ws-market-stream.ts src/data/ws-user-stream.ts
git commit -m "fix(ws): exponential backoff with jitter on reconnect"
```

---

## Task 9: ActiveOrders Map Cleanup (Memory Leak)

**Problem:** `StrategyRunner.activeOrders` Map grows unboundedly — entries never removed.

**Files:**
- Modify: `src/strategy/strategy-runner.ts`

- [ ] **Step 1: Add cleanup in _cancelMarketOrders**

After successfully cancelling all orders for a market, delete the entry:

```ts
private async _cancelMarketOrders(conditionId: string): Promise<void> {
  const slots = this.activeOrders.get(conditionId);
  if (!slots) return;

  const cancellations: Array<{ side: 'buy' | 'sell'; orderId: string }> = [];
  if (slots.buy.orderId) cancellations.push({ side: 'buy', orderId: slots.buy.orderId });
  if (slots.sell.orderId) cancellations.push({ side: 'sell', orderId: slots.sell.orderId });

  const results = await Promise.allSettled(
    cancellations.map((cancel) => this.orderRouter.cancelOrder(cancel.orderId))
  );

  results.forEach((result, index) => {
    const cancel = cancellations[index];
    if (result.status === 'fulfilled') {
      slots[cancel.side].orderId = null;
    } else {
      this.deps.logger.error('Failed to cancel market order', {
        conditionId,
        side: cancel.side,
        orderId: cancel.orderId,
        error: String(result.reason),
      });
    }
  });

  // Clean up empty slot entries to prevent memory leak
  if (!slots.buy.orderId && !slots.sell.orderId) {
    this.activeOrders.delete(conditionId);
  }
}
```

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/strategy/strategy-runner.ts
git commit -m "fix(strategy): clean up empty ActiveOrder slots to prevent memory leak"
```

---

## Task 10: cancelAll Error Handling in OrderRouter

**Problem:** `Promise.all` in `cancelAll()` fails fast — if one cancel fails, others may not complete.

**Files:**
- Modify: `src/execution/order-router.ts`

- [ ] **Step 1: Replace Promise.all with Promise.allSettled**

In `OrderRouter.cancelAll()`, replace:
```ts
await Promise.all(
  openOrders
    .map(...)
    .map((orderId) => this.liveSubmitter!.cancel(orderId))
);
```
with:
```ts
const results = await Promise.allSettled(
  openOrders
    .map((order) => order.id ?? order.orderID ?? order.orderId)
    .filter((orderId): orderId is string => typeof orderId === 'string' && orderId.length > 0)
    .map((orderId) => this.liveSubmitter!.cancel(orderId))
);
const failed = results.filter((r) => r.status === 'rejected').length;
if (failed > 0) {
  // Log but don't throw — we want to cancel as many as possible
  console.error(`cancelAll: ${failed}/${results.length} cancels failed`);
}
```

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/execution/order-router.ts
git commit -m "fix(execution): use Promise.allSettled in cancelAll to handle partial failures"
```

---

## Task 11: Real Toxicity Score in Paper Mode

**Problem:** `run-paper.ts` hardcodes `toxicityScore = 0.1` — paper mode never sees real toxic flow.

**Files:**
- Modify: `src/run-paper.ts`

- [ ] **Step 1: Wire computeToxicityScore into evaluateMarket**

Import at top of `run-paper.ts`:
```ts
import { computeToxicityScore } from './engines/toxicity-engine';
```

In `evaluateMarket()`, replace:
```ts
const toxicityScore = 0.1;
```
with:
```ts
// Compute real toxicity from book/flow data
const flowState = {
  trades10s: 0, // TODO: track from WS trade events
  midpointChange60sCents: Math.abs((yesBook.midpoint ?? 0) - (yesBook.lastTradePrice ?? yesBook.midpoint ?? 0)) * 100,
  takerBuyVolume60sUsd: 0,
  takerSellVolume60sUsd: 0,
  largeTradeCount60s: 0,
  bookHashChanges10s: 0,
  wsDisconnectsLast5m: 0,
};
const toxicityScore = computeToxicityScore(flowState);
```

(This is a minimal version — full flow tracking requires WS trade event counters, which is a follow-up.)

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/run-paper.ts
git commit -m "feat(paper): use real toxicity engine instead of hardcoded 0.1"
```

---

## Task 12: Dynamic Tick Size from Orderbook API

**Problem:** `tickSize: 0.01` and `minOrderSize: 1` are hardcoded in `mapClobBook()`. Some markets may differ.

**Files:**
- Modify: `src/data/clob-orderbook-client.ts`
- Modify: `src/data/ws-market-stream.ts`

- [ ] **Step 1: Parse tick_size and min_order_size from API response**

In `mapClobBook()`, replace:
```ts
const tickSize = 0.01;
const minOrderSize = 1;
```
with:
```ts
const tickSize = data.tick_size ? parseFloat(data.tick_size) : 0.01;
const minOrderSize = data.min_order_size ? parseFloat(data.min_order_size) : 1;
```

- [ ] **Step 2: Parse from WS book snapshot**

In `WsMarketStream.mapBook()`, parse from payload:
```ts
const tickSize = payload.tick_size ? parseFloat(payload.tick_size) : 0.01;
const minOrderSize = payload.min_order_size ? parseFloat(payload.min_order_size) : 1;
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/data/clob-orderbook-client.ts src/data/ws-market-stream.ts
git commit -m "fix(data): parse tick_size and min_order_size from API instead of hardcoding"
```

---

## Task 13: Update .env.example and .gitignore

**Files:**
- Modify: `.env.example`
- Modify: `.gitignore`

- [ ] **Step 1: Add WALLET_ADDRESS to .env.example**

```
# Wallet address for position reconciliation (Data API)
# Your proxy wallet or EOA that holds positions
WALLET_ADDRESS=
```

- [ ] **Step 2: Add AI tool files to .gitignore**

Append:
```
# AI tooling
.claude/
.mcp.json
```

- [ ] **Step 3: Commit**

```bash
git add .env.example .gitignore
git commit -m "chore: add WALLET_ADDRESS env, gitignore AI tool files"
```

---

## Task 14: Full Integration Test

**Files:**
- No code changes — verification only

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests PASS (155+ tests)

- [ ] **Step 2: Build check**

Run: `npm run build`
Expected: Clean TypeScript compilation

- [ ] **Step 3: Verify paper mode starts cleanly**

Run: `npm run start:paper` (with real env vars)
Expected: Bot starts, loads positions from Data API, begins quoting

- [ ] **Step 4: Verify graceful shutdown**

Send SIGINT to paper process:
Expected: "Paper shutdown requested" log, clean exit

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: live-106 hardening complete"
git push origin main
```

---

## Summary

| Task | Fix | Severity | Est. Time |
|------|-----|----------|-----------|
| 1 | HTTP timeouts | 🔴 Critical | 15min |
| 2 | Data API client | 🔴 Critical | 30min |
| 3 | InventoryTracker.loadPositions | 🔴 Critical | 20min |
| 4 | Live position reconciliation | 🔴 Critical | 20min |
| 5 | Paper position reconciliation | 🔴 Critical | 15min |
| 6 | Graceful shutdown | 🔴 Critical | 15min |
| 7 | Kill switch real data | 🔴 Critical | 20min |
| 8 | WS reconnect backoff | 🟠 High | 20min |
| 9 | ActiveOrders cleanup | 🟠 High | 15min |
| 10 | cancelAll error handling | 🟠 High | 10min |
| 11 | Real toxicity in paper | 🟡 Medium | 15min |
| 12 | Dynamic tick size | 🟡 Medium | 10min |
| 13 | Env/gitignore cleanup | 🟢 Low | 5min |
| 14 | Integration verification | — | 15min |

**Total: ~4.5 hours estimated**
