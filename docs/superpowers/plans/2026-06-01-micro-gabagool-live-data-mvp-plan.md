# micro_gabagool_maker_v1 Live Data MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect `micro_gabagool_maker_v1` to live Polymarket Gamma/CLOB data in paper/shadow mode without placing real orders.

**Architecture:** Add three adapters around the existing pure strategy core: a rolling stats store, a CLOB orderbook normalizer, and a Gamma scanner that emits `MarketCandidate[]`. Then wire a safe CLI bootstrap and `npm run start:gabagool` script.

**Tech Stack:** TypeScript, Jest, tsx, native `fetch`, Gamma API, Polymarket CLOB API, existing Telegram notifier.

---

## File Structure

- Create `src/strategy/micro-gabagool-rolling-stats.ts`
  - Pure/stateful in-memory WMP and spread sample tracker.
- Create `tests/strategy/micro-gabagool-rolling-stats.test.ts`
  - Tests WMP formula, 3-minute delta, 60-second spread changes, pruning.
- Create `src/data/micro-gabagool-clob-orderbook-client.ts`
  - Fetches `/book?token_id=...`, normalizes best bid/ask and USD sizes.
- Create `tests/data/micro-gabagool-clob-orderbook-client.test.ts`
  - Tests injected fetch, malformed payloads, missing sides, sorting.
- Create `src/strategy/gamma-micro-gabagool-scanner.ts`
  - Fetches Gamma markets, extracts YES token id, enriches from CLOB client, updates rolling stats, returns `MarketCandidate[]`.
- Create `tests/strategy/gamma-micro-gabagool-scanner.test.ts`
  - Tests valid market normalization, skip behavior, per-market orderbook failure.
- Modify `src/run-micro-gabagool.ts`
  - Add `createGabagoolRuntimeFromEnv`, JSONL writer helper, guarded CLI loop.
- Modify `tests/integration/micro-gabagool-integration.test.ts`
  - Add script/runtime safety tests.
- Modify `package.json`
  - Add `start:gabagool`: `tsx src/run-micro-gabagool.ts`.
- Modify `docs/micro-gabagool-maker-v1.md`
  - Update Quick Start with live-data paper/shadow notes.

---

## Task 1: Rolling Market Stats

**Files:**
- Create: `src/strategy/micro-gabagool-rolling-stats.ts`
- Create: `tests/strategy/micro-gabagool-rolling-stats.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/strategy/micro-gabagool-rolling-stats.test.ts` with tests for:

```typescript
import { computeWeightedMidPrice, RollingMarketStats } from '../../src/strategy/micro-gabagool-rolling-stats';

describe('computeWeightedMidPrice', () => {
  it('computes WMP from bid/ask prices and USD sizes', () => {
    expect(computeWeightedMidPrice({ bestBid: 0.40, bestAsk: 0.44, bestBidSizeUsd: 20, bestAskSizeUsd: 10 })).toBeCloseTo(0.413333, 6);
  });

  it('returns midpoint when both top sizes are zero', () => {
    expect(computeWeightedMidPrice({ bestBid: 0.40, bestAsk: 0.44, bestBidSizeUsd: 0, bestAskSizeUsd: 0 })).toBeCloseTo(0.42, 6);
  });
});

describe('RollingMarketStats', () => {
  it('returns zero deltas for first sample', () => {
    const stats = new RollingMarketStats();
    const result = stats.update('m1', { timestampMs: 0, bestBid: 0.40, bestAsk: 0.44, bestBidSizeUsd: 20, bestAskSizeUsd: 10 });
    expect(result.wmpDelta3Min).toBe(0);
    expect(result.spreadChangesLast60Sec).toBe(0);
  });

  it('computes absolute WMP delta against sample near 3 minutes ago', () => {
    const stats = new RollingMarketStats();
    stats.update('m1', { timestampMs: 0, bestBid: 0.40, bestAsk: 0.44, bestBidSizeUsd: 20, bestAskSizeUsd: 10 });
    const result = stats.update('m1', { timestampMs: 180_000, bestBid: 0.43, bestAsk: 0.47, bestBidSizeUsd: 20, bestAskSizeUsd: 10 });
    expect(result.wmpDelta3Min).toBeGreaterThan(0.02);
  });

  it('counts spread changes during last 60 seconds', () => {
    const stats = new RollingMarketStats();
    stats.update('m1', { timestampMs: 0, bestBid: 0.40, bestAsk: 0.44, bestBidSizeUsd: 20, bestAskSizeUsd: 10 });
    stats.update('m1', { timestampMs: 30_000, bestBid: 0.40, bestAsk: 0.45, bestBidSizeUsd: 20, bestAskSizeUsd: 10 });
    const result = stats.update('m1', { timestampMs: 50_000, bestBid: 0.40, bestAsk: 0.46, bestBidSizeUsd: 20, bestAskSizeUsd: 10 });
    expect(result.spreadChangesLast60Sec).toBe(2);
  });
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
npm test -- tests/strategy/micro-gabagool-rolling-stats.test.ts --runInBand
```

Expected: fails because module does not exist.

- [ ] **Step 3: Implement minimal code**

Create `src/strategy/micro-gabagool-rolling-stats.ts` with:

```typescript
export interface WmpInput {
  bestBid: number;
  bestAsk: number;
  bestBidSizeUsd: number;
  bestAskSizeUsd: number;
}

export interface MarketStatsSample extends WmpInput {
  timestampMs: number;
}

export interface RollingMarketStatsResult {
  wmp: number;
  wmpDelta3Min: number;
  spreadChangesLast60Sec: number;
}

interface StoredSample {
  timestampMs: number;
  wmp: number;
  spread: number;
}

export function computeWeightedMidPrice(input: WmpInput): number {
  const totalSize = input.bestBidSizeUsd + input.bestAskSizeUsd;
  if (totalSize <= 0) return (input.bestBid + input.bestAsk) / 2;
  return ((input.bestBid * input.bestAskSizeUsd) + (input.bestAsk * input.bestBidSizeUsd)) / totalSize;
}

export class RollingMarketStats {
  private readonly history = new Map<string, StoredSample[]>();

  update(marketId: string, sample: MarketStatsSample): RollingMarketStatsResult {
    const wmp = computeWeightedMidPrice(sample);
    const spread = sample.bestAsk - sample.bestBid;
    const samples = this.history.get(marketId) ?? [];
    samples.push({ timestampMs: sample.timestampMs, wmp, spread });

    const cutoff = sample.timestampMs - 300_000;
    const pruned = samples.filter(s => s.timestampMs >= cutoff);
    this.history.set(marketId, pruned);

    const threeMinAgo = sample.timestampMs - 180_000;
    const reference = [...pruned].reverse().find(s => s.timestampMs <= threeMinAgo);
    const wmpDelta3Min = reference ? Math.abs(wmp - reference.wmp) : 0;

    const spreadWindow = pruned.filter(s => s.timestampMs >= sample.timestampMs - 60_000);
    let spreadChangesLast60Sec = 0;
    for (let i = 1; i < spreadWindow.length; i += 1) {
      if (Math.abs(spreadWindow[i].spread - spreadWindow[i - 1].spread) > 1e-9) {
        spreadChangesLast60Sec += 1;
      }
    }

    return { wmp, wmpDelta3Min, spreadChangesLast60Sec };
  }
}
```

- [ ] **Step 4: Run test and verify GREEN**

Run same focused test. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/strategy/micro-gabagool-rolling-stats.ts tests/strategy/micro-gabagool-rolling-stats.test.ts
git commit -m "feat(gabagool): add rolling market stats"
```

---

## Task 2: CLOB Orderbook Adapter

**Files:**
- Create: `src/data/micro-gabagool-clob-orderbook-client.ts`
- Create: `tests/data/micro-gabagool-clob-orderbook-client.test.ts`

- [ ] **Step 1: Write failing tests**

Test injected fetch and normalization:

```typescript
import { MicroGabagoolClobOrderbookClient } from '../../src/data/micro-gabagool-clob-orderbook-client';

const okResponse = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => body } as Response);

describe('MicroGabagoolClobOrderbookClient', () => {
  it('normalizes best bid/ask and USD sizes', async () => {
    const fetchFn = jest.fn().mockImplementation(() => okResponse({ bids: [{ price: '0.40', size: '100' }], asks: [{ price: '0.44', size: '50' }] }));
    const client = new MicroGabagoolClobOrderbookClient({ baseUrl: 'https://clob.test', fetchFn });
    const book = await client.getTopOfBook('token-1');
    expect(book).toEqual({ bestBid: 0.40, bestAsk: 0.44, bestBidSizeUsd: 40, bestAskSizeUsd: 22 });
    expect(fetchFn).toHaveBeenCalledWith('https://clob.test/book?token_id=token-1');
  });

  it('sorts unordered levels conservatively', async () => {
    const fetchFn = jest.fn().mockImplementation(() => okResponse({ bids: [{ price: '0.39', size: '100' }, { price: '0.41', size: '10' }], asks: [{ price: '0.45', size: '50' }, { price: '0.43', size: '20' }] }));
    const client = new MicroGabagoolClobOrderbookClient({ baseUrl: 'https://clob.test', fetchFn });
    const book = await client.getTopOfBook('token-1');
    expect(book.bestBid).toBe(0.41);
    expect(book.bestAsk).toBe(0.43);
  });

  it('returns null when one side is missing', async () => {
    const fetchFn = jest.fn().mockImplementation(() => okResponse({ bids: [{ price: '0.40', size: '100' }], asks: [] }));
    const client = new MicroGabagoolClobOrderbookClient({ baseUrl: 'https://clob.test', fetchFn });
    await expect(client.getTopOfBook('token-1')).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run test and verify RED**

```bash
npm test -- tests/data/micro-gabagool-clob-orderbook-client.test.ts --runInBand
```

- [ ] **Step 3: Implement adapter**

Create `src/data/micro-gabagool-clob-orderbook-client.ts` with injected `fetchFn`, `/book?token_id=...`, level parsing, best bid max price, best ask min price, and null for invalid books.

- [ ] **Step 4: Run focused test**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/micro-gabagool-clob-orderbook-client.ts tests/data/micro-gabagool-clob-orderbook-client.test.ts
git commit -m "feat(gabagool): add CLOB orderbook adapter"
```

---

## Task 3: Gamma Scanner

**Files:**
- Create: `src/strategy/gamma-micro-gabagool-scanner.ts`
- Create: `tests/strategy/gamma-micro-gabagool-scanner.test.ts`

- [ ] **Step 1: Write failing tests**

Tests must inject `fetchFn`, fake orderbook client, and `nowMs`.

Required cases:
- valid Gamma market becomes `MarketCandidate`
- closed/inactive market is skipped
- market without YES token is skipped
- orderbook failure for one market does not fail whole scan

- [ ] **Step 2: Run test and verify RED**

```bash
npm test -- tests/strategy/gamma-micro-gabagool-scanner.test.ts --runInBand
```

- [ ] **Step 3: Implement scanner**

Scanner contract:

```typescript
export interface GammaMicroGabagoolScannerConfig {
  gammaBaseUrl: string;
  maxMarketsPerScan: number;
  fetchFn?: typeof fetch;
  nowMs: () => number;
}
```

Fetch URL:

```text
{gammaBaseUrl}/markets?active=true&closed=false&limit={maxMarketsPerScan}
```

Normalize token ids from either `clobTokenIds` JSON string or array. For v1 use YES token index 0.

Return `MarketCandidate` with:
- `conditionId`
- `question`
- `bestBid`, `bestAsk`, `bestBidSizeUsd`, `bestAskSizeUsd`
- `wmpDelta3Min`, `spreadChangesLast60Sec`
- `timeToSettlementMin`

- [ ] **Step 4: Run focused test**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/strategy/gamma-micro-gabagool-scanner.ts tests/strategy/gamma-micro-gabagool-scanner.test.ts
git commit -m "feat(gabagool): add Gamma live-data scanner"
```

---

## Task 4: Runner CLI and Script

**Files:**
- Modify: `src/run-micro-gabagool.ts`
- Modify: `tests/integration/micro-gabagool-integration.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing tests**

Add tests that:
- `package.json` contains `start:gabagool`.
- `createGabagoolRuntimeFromEnv` defaults to paper mode.
- `createGabagoolRuntimeFromEnv` rejects `MODE=live` unless `ENABLE_LIVE_TRADING=true`.

- [ ] **Step 2: Run tests and verify RED**

```bash
npm test -- tests/integration/micro-gabagool-integration.test.ts --runInBand
```

- [ ] **Step 3: Implement runtime factory and script**

Add exported factory:

```typescript
export function createGabagoolRuntimeFromEnv(env: NodeJS.ProcessEnv = process.env): { config: MicroGabagoolConfig; logPath: string; intervalMs: number };
```

Add guarded CLI:

```typescript
if (require.main === module) {
  void main();
}
```

Use existing `TelegramNotifier` only when env vars exist.

- [ ] **Step 4: Run focused tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/run-micro-gabagool.ts tests/integration/micro-gabagool-integration.test.ts package.json
git commit -m "feat(gabagool): wire live-data runner script"
```

---

## Task 5: Verification and Docs

**Files:**
- Modify: `docs/micro-gabagool-maker-v1.md`

- [ ] **Step 1: Update docs**

Document:
- `npm run start:gabagool`
- env vars: `MODE`, `GABAGOOL_SCAN_INTERVAL_MS`, `GABAGOOL_MAX_MARKETS_PER_SCAN`, `GAMMA_API_BASE_URL`, `CLOB_API_BASE_URL`
- Paper/shadow only status
- JSONL path

- [ ] **Step 2: Run full verification**

```bash
npm test -- --runInBand
npm run build
```

Expected:
- all tests pass
- TypeScript build succeeds

- [ ] **Step 3: Commit docs**

```bash
git add docs/micro-gabagool-maker-v1.md
git commit -m "docs(gabagool): document live-data paper runner"
```

---

## Self-Review

- Spec coverage: scanner, orderbook adapter, rolling stats, runner script, JSONL/Telegram safety are covered by Tasks 1-5.
- Placeholder scan: no task depends on undefined future work; live order placement remains explicitly out of scope.
- Type consistency: `MarketCandidate` remains imported from `src/run-micro-gabagool.ts`; new scanner emits that existing type.
- Safety: no private keys or live order submitter are introduced.
