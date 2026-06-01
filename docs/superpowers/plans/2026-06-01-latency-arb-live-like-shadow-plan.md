# Latency Arb Live-Like Shadow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a BTC 15-minute latency-arbitrage shadow runtime that behaves like live trading but never submits real orders, recording would-live orders and PnL events to JSONL for a 1–2 hour soak.

**Architecture:** Keep pure decision logic in engines/helpers and orchestration in `src/strategy`. Add BTC 15m market selection, order-book snapshot validation, JSONL event writing, shadow execution, position tracking, and runner wiring. `MODE=small_live` is hard-blocked until a later explicitly approved live phase.

**Tech Stack:** TypeScript, Jest, tsx, Node fs/path, existing Gamma and CLOB clients, Binance WebSocket feed, JSONL logs.

---

## File Structure

### New files

- `src/strategy/latency-arb-market-selector.ts` — pure BTC 15m market filtering and sorting.
- `tests/strategy/latency-arb-market-selector.test.ts` — selector tests.
- `src/strategy/latency-arb-orderbook.ts` — build/validate latency-arb market snapshots from YES/NO books.
- `tests/strategy/latency-arb-orderbook.test.ts` — snapshot validation tests.
- `src/accounting/jsonl-event-writer.ts` — append JSONL event writer.
- `tests/accounting/jsonl-event-writer.test.ts` — writer tests with temp directory.
- `src/simulation/latency-arb-shadow-executor.ts` — would-live post-only order event construction and risk gates.
- `tests/simulation/latency-arb-shadow-executor.test.ts` — executor tests.
- `src/simulation/latency-arb-position-tracker.ts` — hypothetical fill, MTM, and resolution tracking.
- `tests/simulation/latency-arb-position-tracker.test.ts` — position tracker tests.
- `tests/integration/latency-arb-runtime.test.ts` — runtime path integration with injected fixture market/book dependencies.

### Modified files

- `src/data/binance-ws-feed.ts` — add configurable `wsBaseUrl` and malformed payload validation.
- `tests/data/binance-ws-feed.test.ts` — add custom URL and malformed kline tests, update URL expectation.
- `src/engines/divergence-engine.ts` — make EMA bonus direction-aware.
- `tests/engines/divergence-engine.test.ts` — add bearish aligned EMA test.
- `src/strategy/latency-arb-config.ts` — add live-like shadow config defaults.
- `src/strategy/latency-arb-strategy.ts` — pass Binance URL into feed and expose risk helpers if needed.
- `src/config/env.ts` — parse additional env fields.
- `.env.example` — document new env fields.
- `src/run-latency-arb.ts` — hard-block `small_live`, wire market scanner, book client, event writer, shadow executor, and periodic runtime cycle.
- `docs/latency-arbitrage.md` — document shadow-only status and soak procedure.
- `README.md` — adjust latency-arb description to shadow-only.

---

## Task 1: Harden Binance Feed URL and Payload Validation

**Files:**
- Modify: `src/data/binance-ws-feed.ts`
- Modify: `tests/data/binance-ws-feed.test.ts`

- [ ] **Step 1: Add failing tests for custom URL and malformed payloads**

Add these tests to `tests/data/binance-ws-feed.test.ts` near the existing URL/parse tests:

```typescript
it('should use configured WebSocket base URL', () => {
  const feed = new BinanceWsFeed({
    symbols: ['btcusdt'],
    wsBaseUrl: 'wss://example.test:9443',
  });

  feed.connect();

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const wsModule = require('ws');
  const WsConstructor = wsModule.default as jest.Mock;
  expect(WsConstructor).toHaveBeenLastCalledWith(
    'wss://example.test:9443/stream?streams=btcusdt@kline_1m'
  );
});

it('should return null for malformed kline payloads with non-finite numbers', () => {
  const feed = new BinanceWsFeed();
  const baseMessage = {
    e: 'kline',
    s: 'BTCUSDT',
    k: {
      t: 1700000000000,
      c: '50100.00',
      h: '50200.00',
      l: '49900.00',
      v: '100.00',
    },
  };

  expect(feed.parseMessage({ ...baseMessage, k: { ...baseMessage.k, c: 'not-a-number' } })).toBeNull();
  expect(feed.parseMessage({ ...baseMessage, k: { ...baseMessage.k, h: undefined } })).toBeNull();
  expect(feed.parseMessage({ ...baseMessage, k: { ...baseMessage.k, l: null } })).toBeNull();
  expect(feed.parseMessage({ ...baseMessage, k: { ...baseMessage.k, v: 'NaN' } })).toBeNull();
  expect(feed.parseMessage({ ...baseMessage, s: '' })).toBeNull();
});
```

Update the existing `should construct correct URL from symbols` test to use the default URL but do not remove it.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npm test -- tests/data/binance-ws-feed.test.ts --runInBand
```

Expected: FAIL because `wsBaseUrl` is not in `BinanceWsFeedConfig` and malformed payloads are not rejected.

- [ ] **Step 3: Implement minimal Binance feed changes**

Update `src/data/binance-ws-feed.ts`:

```typescript
export interface BinanceWsFeedConfig {
  symbols: string[];
  wsBaseUrl: string;
  onPriceUpdate: (update: PriceUpdate) => void;
  onError: (error: Error) => void;
}

const DEFAULT_CONFIG: BinanceWsFeedConfig = {
  symbols: ['btcusdt', 'ethusdt'],
  wsBaseUrl: 'wss://stream.binance.com:9443',
  onPriceUpdate: () => {},
  onError: () => {},
};

function finiteNumberFromString(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}
```

In `connect()` replace the hard-coded URL:

```typescript
const baseUrl = this.config.wsBaseUrl.replace(/\/$/, '');
const url = `${baseUrl}/stream?streams=${streams}`;
```

Replace `parseMessage()` body with validated parsing:

```typescript
parseMessage(msg: unknown): PriceUpdate | null {
  try {
    if (typeof msg !== 'object' || msg === null) return null;
    const m = msg as Record<string, unknown>;
    if (m.e !== 'kline' || typeof m.k !== 'object' || m.k === null) return null;

    const symbol = nonEmptyString(m.s);
    if (!symbol) return null;

    const k = m.k as Record<string, unknown>;
    const price = finiteNumberFromString(k.c);
    const timestamp = finiteNumberFromString(k.t);
    const volume = finiteNumberFromString(k.v);
    const high = finiteNumberFromString(k.h);
    const low = finiteNumberFromString(k.l);

    if (
      price === null ||
      timestamp === null ||
      volume === null ||
      high === null ||
      low === null
    ) {
      return null;
    }

    return { symbol, price, timestamp, volume, high, low };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
npm test -- tests/data/binance-ws-feed.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/binance-ws-feed.ts tests/data/binance-ws-feed.test.ts
git commit -m "fix(data): harden Binance feed config and parsing"
```

---

## Task 2: Make Divergence EMA Bonus Direction-Aware

**Files:**
- Modify: `src/engines/divergence-engine.ts`
- Modify: `tests/engines/divergence-engine.test.ts`

- [ ] **Step 1: Add failing bearish EMA alignment test**

Add this test to `tests/engines/divergence-engine.test.ts`:

```typescript
it('should treat bearish EMA alignment as positive for BUY_NO probability', () => {
  const bearishAligned: MomentumSignal = {
    direction: 'BEARISH',
    strength: 0.5,
    priceChangePct: -0.8,
    volumeConfirmed: false,
    emaFast: 49000,
    emaSlow: 50000,
    timestamp: FIXED_TS,
  };

  const bearishMisaligned: MomentumSignal = {
    ...bearishAligned,
    emaFast: 51000,
    emaSlow: 50000,
  };

  const market: MarketSnapshot = {
    yesPrice: 0.55,
    noPrice: 0.49,
    midpoint: 0.52,
    spread: 0.06,
    timestamp: FIXED_TS,
  };

  const aligned = analyzeDivergence(defaultConfig, bearishAligned, market, nowFn);
  const misaligned = analyzeDivergence(defaultConfig, bearishMisaligned, market, nowFn);

  expect(aligned.action).toBe('BUY_NO');
  expect(aligned.expectedValue).toBeGreaterThan(misaligned.expectedValue);
  expect(aligned.divergencePct).toBeGreaterThan(misaligned.divergencePct);
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npm test -- tests/engines/divergence-engine.test.ts --runInBand
```

Expected: FAIL because bearish EMA alignment is currently penalized.

- [ ] **Step 3: Implement minimal direction-aware EMA bonus**

In `src/engines/divergence-engine.ts`, replace:

```typescript
const emaTrend = momentum.emaFast > momentum.emaSlow ? 0.05 : -0.05;
```

with:

```typescript
const emaAligned =
  (momentum.direction === 'BULLISH' && momentum.emaFast > momentum.emaSlow) ||
  (momentum.direction === 'BEARISH' && momentum.emaFast < momentum.emaSlow);
const emaTrend = emaAligned ? 0.05 : -0.05;
```

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
npm test -- tests/engines/divergence-engine.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engines/divergence-engine.ts tests/engines/divergence-engine.test.ts
git commit -m "fix(engines): align divergence EMA bonus with direction"
```

---

## Task 3: Add BTC 15m Market Selector

**Files:**
- Create: `src/strategy/latency-arb-market-selector.ts`
- Create: `tests/strategy/latency-arb-market-selector.test.ts`

- [ ] **Step 1: Write failing selector tests**

Create `tests/strategy/latency-arb-market-selector.test.ts`:

```typescript
import { selectLatencyArbMarkets, LatencyArbMarketSelectionConfig } from '../../src/strategy/latency-arb-market-selector';
import { MarketState } from '../../src/types/market';

const now = 1700000000000;

function market(overrides: Partial<MarketState>): MarketState {
  return {
    conditionId: 'cond-default',
    slug: 'bitcoin-up-or-down-default-15m',
    question: 'Bitcoin Up or Down - 15m',
    yesTokenId: 'yes-default',
    noTokenId: 'no-default',
    active: true,
    closed: false,
    enableOrderBook: true,
    feesEnabled: true,
    endDate: new Date(now + 15 * 60_000).toISOString(),
    volume24hUsd: 1000,
    liquidityUsd: 1000,
    oracleAmbiguityScore: 0.05,
    ...overrides,
  };
}

describe('selectLatencyArbMarkets', () => {
  const config: LatencyArbMarketSelectionConfig = {
    asset: 'BTC',
    durationMinutes: 15,
    maxMarkets: 2,
    nowMs: now,
  };

  it('should select active BTC 15m up/down markets with token ids', () => {
    const markets = [
      market({ conditionId: 'btc-15', slug: 'bitcoin-up-or-down-15m-1' }),
      market({ conditionId: 'eth-15', slug: 'ethereum-up-or-down-15m', question: 'Ethereum Up or Down - 15m' }),
      market({ conditionId: 'btc-5', slug: 'bitcoin-up-or-down-5m', question: 'Bitcoin Up or Down - 5m' }),
      market({ conditionId: 'btc-closed', closed: true }),
      market({ conditionId: 'btc-no-book', enableOrderBook: false }),
      market({ conditionId: 'btc-no-tokens', yesTokenId: '', noTokenId: '' }),
    ];

    const selected = selectLatencyArbMarkets(markets, config);

    expect(selected.map((m) => m.conditionId)).toEqual(['btc-15']);
  });

  it('should order eligible markets by nearest future end date and respect maxMarkets', () => {
    const markets = [
      market({ conditionId: 'later', endDate: new Date(now + 30 * 60_000).toISOString() }),
      market({ conditionId: 'nearest', endDate: new Date(now + 5 * 60_000).toISOString() }),
      market({ conditionId: 'second', endDate: new Date(now + 10 * 60_000).toISOString() }),
    ];

    const selected = selectLatencyArbMarkets(markets, config);

    expect(selected.map((m) => m.conditionId)).toEqual(['nearest', 'second']);
  });

  it('should ignore expired markets when endDate is known', () => {
    const markets = [
      market({ conditionId: 'expired', endDate: new Date(now - 60_000).toISOString() }),
      market({ conditionId: 'future', endDate: new Date(now + 60_000).toISOString() }),
    ];

    const selected = selectLatencyArbMarkets(markets, config);

    expect(selected.map((m) => m.conditionId)).toEqual(['future']);
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npm test -- tests/strategy/latency-arb-market-selector.test.ts --runInBand
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement selector**

Create `src/strategy/latency-arb-market-selector.ts`:

```typescript
import { MarketState } from '../types/market';

export interface LatencyArbMarketSelectionConfig {
  asset: 'BTC';
  durationMinutes: number;
  maxMarkets: number;
  nowMs: number;
}

function textOf(market: MarketState): string {
  return `${market.slug ?? ''} ${market.question ?? ''}`.toLowerCase();
}

function isBtcMarket(market: MarketState): boolean {
  const text = textOf(market);
  return text.includes('btc') || text.includes('bitcoin');
}

function isUpDownMarket(market: MarketState): boolean {
  const text = textOf(market);
  return (text.includes('up') && text.includes('down')) || text.includes('higher or lower');
}

function isDurationMarket(market: MarketState, durationMinutes: number): boolean {
  const text = textOf(market);
  const durationPatterns = [
    `${durationMinutes}m`,
    `${durationMinutes} m`,
    `${durationMinutes}-minute`,
    `${durationMinutes} minute`,
    `${durationMinutes}min`,
  ];
  return durationPatterns.some((pattern) => text.includes(pattern));
}

function endTimeMs(market: MarketState): number {
  if (!market.endDate) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(market.endDate);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

export function selectLatencyArbMarkets(
  markets: MarketState[],
  config: LatencyArbMarketSelectionConfig
): MarketState[] {
  return markets
    .filter((market) => market.active === true)
    .filter((market) => market.closed === false)
    .filter((market) => market.enableOrderBook === true)
    .filter((market) => market.yesTokenId.length > 0 && market.noTokenId.length > 0)
    .filter((market) => isBtcMarket(market))
    .filter((market) => isUpDownMarket(market))
    .filter((market) => isDurationMarket(market, config.durationMinutes))
    .filter((market) => endTimeMs(market) > config.nowMs)
    .sort((a, b) => endTimeMs(a) - endTimeMs(b))
    .slice(0, config.maxMarkets);
}
```

- [ ] **Step 4: Run test to verify GREEN**

Run:

```bash
npm test -- tests/strategy/latency-arb-market-selector.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/strategy/latency-arb-market-selector.ts tests/strategy/latency-arb-market-selector.test.ts
git commit -m "feat(strategy): select BTC 15m latency arb markets"
```

---

## Task 4: Add Order Book Snapshot Builder

**Files:**
- Create: `src/strategy/latency-arb-orderbook.ts`
- Create: `tests/strategy/latency-arb-orderbook.test.ts`

- [ ] **Step 1: Write failing snapshot tests**

Create `tests/strategy/latency-arb-orderbook.test.ts`:

```typescript
import { buildLatencyArbSnapshot, LatencyArbBookPair } from '../../src/strategy/latency-arb-orderbook';
import { BookState } from '../../src/types/book';

const now = 1700000000000;

function book(overrides: Partial<BookState>): BookState {
  return {
    tokenId: 'token',
    conditionId: 'condition',
    bids: [],
    asks: [],
    bestBid: 0.44,
    bestAsk: 0.46,
    bestBidSizeUsd: 100,
    bestAskSizeUsd: 100,
    midpoint: 0.45,
    spread: 0.02,
    spreadTicks: 2,
    depth1Usd: 200,
    depth3Usd: 500,
    tickSize: 0.01,
    minOrderSize: 1,
    lastUpdateMs: now,
    ...overrides,
  };
}

describe('buildLatencyArbSnapshot', () => {
  it('should build snapshot and execution prices from YES and NO books', () => {
    const pair: LatencyArbBookPair = {
      yes: book({ tokenId: 'yes', bestBid: 0.44, bestAsk: 0.46, midpoint: 0.45, spread: 0.02 }),
      no: book({ tokenId: 'no', bestBid: 0.54, bestAsk: 0.56, midpoint: 0.55, spread: 0.02 }),
    };

    const result = buildLatencyArbSnapshot(pair, {
      nowMs: now + 100,
      maxMarketAgeMs: 2000,
      maxSpreadCents: 8,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.snapshot.yesPrice).toBe(0.46);
    expect(result.snapshot.noPrice).toBe(0.56);
    expect(result.execution.yesBestBid).toBe(0.44);
    expect(result.execution.yesBestAsk).toBe(0.46);
    expect(result.execution.noBestBid).toBe(0.54);
    expect(result.execution.noBestAsk).toBe(0.56);
  });

  it('should reject stale books', () => {
    const result = buildLatencyArbSnapshot({ yes: book({}), no: book({}) }, {
      nowMs: now + 5000,
      maxMarketAgeMs: 2000,
      maxSpreadCents: 8,
    });

    expect(result).toEqual({ ok: false, reason: 'stale_orderbook' });
  });

  it('should reject wide spreads', () => {
    const result = buildLatencyArbSnapshot({
      yes: book({ bestBid: 0.40, bestAsk: 0.55, midpoint: 0.475, spread: 0.15 }),
      no: book({ bestBid: 0.45, bestAsk: 0.60, midpoint: 0.525, spread: 0.15 }),
    }, {
      nowMs: now,
      maxMarketAgeMs: 2000,
      maxSpreadCents: 8,
    });

    expect(result).toEqual({ ok: false, reason: 'spread_too_wide' });
  });

  it('should reject missing prices', () => {
    const result = buildLatencyArbSnapshot({ yes: book({ bestAsk: null }), no: book({}) }, {
      nowMs: now,
      maxMarketAgeMs: 2000,
      maxSpreadCents: 8,
    });

    expect(result).toEqual({ ok: false, reason: 'invalid_orderbook_price' });
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npm test -- tests/strategy/latency-arb-orderbook.test.ts --runInBand
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement snapshot builder**

Create `src/strategy/latency-arb-orderbook.ts`:

```typescript
import { BookState } from '../types/book';
import { MarketSnapshot } from '../engines/divergence-engine';

export interface LatencyArbBookPair {
  yes: BookState;
  no: BookState;
}

export interface LatencyArbExecutionSnapshot {
  yesBestBid: number;
  yesBestAsk: number;
  noBestBid: number;
  noBestAsk: number;
  tickSize: number;
  minOrderSize: number;
}

export interface LatencyArbSnapshotConfig {
  nowMs: number;
  maxMarketAgeMs: number;
  maxSpreadCents: number;
}

export type LatencyArbSnapshotResult =
  | { ok: true; snapshot: MarketSnapshot; execution: LatencyArbExecutionSnapshot }
  | { ok: false; reason: 'stale_orderbook' | 'spread_too_wide' | 'invalid_orderbook_price' };

function isFinitePositive(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function buildLatencyArbSnapshot(
  books: LatencyArbBookPair,
  config: LatencyArbSnapshotConfig
): LatencyArbSnapshotResult {
  const maxAge = Math.max(
    config.nowMs - books.yes.lastUpdateMs,
    config.nowMs - books.no.lastUpdateMs
  );
  if (maxAge > config.maxMarketAgeMs) return { ok: false, reason: 'stale_orderbook' };

  if (
    !isFinitePositive(books.yes.bestBid) ||
    !isFinitePositive(books.yes.bestAsk) ||
    !isFinitePositive(books.no.bestBid) ||
    !isFinitePositive(books.no.bestAsk)
  ) {
    return { ok: false, reason: 'invalid_orderbook_price' };
  }

  const yesSpread = books.yes.bestAsk - books.yes.bestBid;
  const noSpread = books.no.bestAsk - books.no.bestBid;
  if (!Number.isFinite(yesSpread) || !Number.isFinite(noSpread) || yesSpread < 0 || noSpread < 0) {
    return { ok: false, reason: 'invalid_orderbook_price' };
  }

  const maxSpread = Math.max(yesSpread, noSpread);
  if (maxSpread * 100 > config.maxSpreadCents) return { ok: false, reason: 'spread_too_wide' };

  const snapshot: MarketSnapshot = {
    yesPrice: books.yes.bestAsk,
    noPrice: books.no.bestAsk,
    midpoint: (books.yes.bestAsk + books.no.bestAsk) / 2,
    spread: maxSpread,
    timestamp: config.nowMs,
  };

  return {
    ok: true,
    snapshot,
    execution: {
      yesBestBid: books.yes.bestBid,
      yesBestAsk: books.yes.bestAsk,
      noBestBid: books.no.bestBid,
      noBestAsk: books.no.bestAsk,
      tickSize: Math.min(books.yes.tickSize, books.no.tickSize),
      minOrderSize: Math.max(books.yes.minOrderSize, books.no.minOrderSize),
    },
  };
}
```

- [ ] **Step 4: Run test to verify GREEN**

Run:

```bash
npm test -- tests/strategy/latency-arb-orderbook.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/strategy/latency-arb-orderbook.ts tests/strategy/latency-arb-orderbook.test.ts
git commit -m "feat(strategy): build latency arb orderbook snapshots"
```

---

## Task 5: Add JSONL Event Writer

**Files:**
- Create: `src/accounting/jsonl-event-writer.ts`
- Create: `tests/accounting/jsonl-event-writer.test.ts`

- [ ] **Step 1: Write failing writer tests**

Create `tests/accounting/jsonl-event-writer.test.ts`:

```typescript
import fs from 'fs';
import os from 'os';
import path from 'path';
import { JsonlEventWriter } from '../../src/accounting/jsonl-event-writer';

describe('JsonlEventWriter', () => {
  it('should append events as JSON lines and create log directory', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'latency-jsonl-'));
    const writer = new JsonlEventWriter({ logDir: path.join(dir, 'logs'), filePrefix: 'latency-arb-orders' });

    writer.write({ eventType: 'signal', timestamp: 1700000000000, value: 1 });
    writer.write({ eventType: 'skip', timestamp: 1700000001000, reason: 'test' });

    const filePath = writer.getCurrentFilePath();
    expect(fs.existsSync(filePath)).toBe(true);

    const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({ eventType: 'signal', timestamp: 1700000000000, value: 1 });
    expect(JSON.parse(lines[1])).toEqual({ eventType: 'skip', timestamp: 1700000001000, reason: 'test' });
  });

  it('should use date from injected clock in file name', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'latency-jsonl-'));
    const writer = new JsonlEventWriter({
      logDir: dir,
      filePrefix: 'latency-arb-orders',
      nowFn: () => new Date('2026-06-01T12:00:00Z'),
    });

    expect(path.basename(writer.getCurrentFilePath())).toBe('latency-arb-orders-2026-06-01.jsonl');
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npm test -- tests/accounting/jsonl-event-writer.test.ts --runInBand
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement JSONL writer**

Create `src/accounting/jsonl-event-writer.ts`:

```typescript
import fs from 'fs';
import path from 'path';

export interface JsonlEventWriterConfig {
  logDir: string;
  filePrefix: string;
  nowFn?: () => Date;
  onError?: (error: Error) => void;
}

export class JsonlEventWriter {
  private readonly nowFn: () => Date;

  constructor(private readonly config: JsonlEventWriterConfig) {
    this.nowFn = config.nowFn ?? (() => new Date());
  }

  getCurrentFilePath(): string {
    const date = this.nowFn().toISOString().slice(0, 10);
    return path.join(this.config.logDir, `${this.config.filePrefix}-${date}.jsonl`);
  }

  write(event: Record<string, unknown>): boolean {
    try {
      fs.mkdirSync(this.config.logDir, { recursive: true });
      fs.appendFileSync(this.getCurrentFilePath(), `${JSON.stringify(event)}\n`, 'utf8');
      return true;
    } catch (err) {
      this.config.onError?.(err as Error);
      return false;
    }
  }
}
```

- [ ] **Step 4: Run test to verify GREEN**

Run:

```bash
npm test -- tests/accounting/jsonl-event-writer.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/accounting/jsonl-event-writer.ts tests/accounting/jsonl-event-writer.test.ts
git commit -m "feat(accounting): add JSONL event writer"
```

---

## Task 6: Add Shadow Executor

**Files:**
- Create: `src/simulation/latency-arb-shadow-executor.ts`
- Create: `tests/simulation/latency-arb-shadow-executor.test.ts`

- [ ] **Step 1: Write failing shadow executor tests**

Create `tests/simulation/latency-arb-shadow-executor.test.ts`:

```typescript
import { LatencyArbShadowExecutor, ShadowExecutorConfig } from '../../src/simulation/latency-arb-shadow-executor';
import { DivergenceSignal } from '../../src/engines/divergence-engine';
import { MarketState } from '../../src/types/market';
import { LatencyArbExecutionSnapshot } from '../../src/strategy/latency-arb-orderbook';

const market: MarketState = {
  conditionId: 'cond-btc-15',
  slug: 'bitcoin-up-or-down-15m',
  question: 'Bitcoin Up or Down - 15m',
  yesTokenId: 'yes',
  noTokenId: 'no',
  active: true,
  closed: false,
  enableOrderBook: true,
  feesEnabled: true,
  volume24hUsd: 1000,
  liquidityUsd: 1000,
  oracleAmbiguityScore: 0.05,
};

const execution: LatencyArbExecutionSnapshot = {
  yesBestBid: 0.44,
  yesBestAsk: 0.46,
  noBestBid: 0.54,
  noBestAsk: 0.56,
  tickSize: 0.01,
  minOrderSize: 1,
};

const signal: DivergenceSignal = {
  action: 'BUY_YES',
  divergencePct: 20,
  expectedValue: 0.1,
  expectedValuePct: 22,
  entryPrice: 0.46,
  confidence: 0.8,
  timestamp: 1700000000000,
};

const config: ShadowExecutorConfig = {
  mode: 'shadow',
  asset: 'BTC',
  duration: '15m',
  startingBalanceUsd: 15.48,
  orderBalanceFraction: 0.1,
  maxOrderSizeUsd: 1.55,
  maxPositionUsd: 1.55,
  minConfidence: 0.6,
};

describe('LatencyArbShadowExecutor', () => {
  it('should create a post-only would-place order event for actionable signal', () => {
    const writes: Record<string, unknown>[] = [];
    const executor = new LatencyArbShadowExecutor(config, (event) => writes.push(event));

    const result = executor.evaluate({ market, signal, execution, nowMs: 1700000000100, currentExposureUsd: 0 });

    expect(result.ok).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      eventType: 'would_place_order',
      mode: 'shadow',
      asset: 'BTC',
      duration: '15m',
      conditionId: 'cond-btc-15',
      action: 'BUY_YES',
      orderType: 'post_only_limit',
      makerPrice: 0.44,
      takerPrice: 0.46,
    });
    expect(writes[0].sizeUsd).toBeCloseTo(1.548, 3);
    expect(writes[0].shares).toBeCloseTo(1.548 / 0.44, 3);
  });

  it('should write skip when confidence is too low', () => {
    const writes: Record<string, unknown>[] = [];
    const executor = new LatencyArbShadowExecutor(config, (event) => writes.push(event));

    const result = executor.evaluate({
      market,
      signal: { ...signal, confidence: 0.5 },
      execution,
      nowMs: 1700000000100,
      currentExposureUsd: 0,
    });

    expect(result).toEqual({ ok: false, reason: 'confidence_too_low' });
    expect(writes[0]).toMatchObject({ eventType: 'skip', reason: 'confidence_too_low' });
  });

  it('should reject when exposure cap would be exceeded', () => {
    const writes: Record<string, unknown>[] = [];
    const executor = new LatencyArbShadowExecutor(config, (event) => writes.push(event));

    const result = executor.evaluate({ market, signal, execution, nowMs: 1700000000100, currentExposureUsd: 1.0 });

    expect(result).toEqual({ ok: false, reason: 'position_limit_exceeded' });
    expect(writes[0]).toMatchObject({ eventType: 'skip', reason: 'position_limit_exceeded' });
  });

  it('should not call any live submitter', () => {
    const liveSubmitter = { submit: jest.fn() };
    const executor = new LatencyArbShadowExecutor(config, () => undefined);

    executor.evaluate({ market, signal, execution, nowMs: 1700000000100, currentExposureUsd: 0 });

    expect(liveSubmitter.submit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npm test -- tests/simulation/latency-arb-shadow-executor.test.ts --runInBand
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement shadow executor**

Create `src/simulation/latency-arb-shadow-executor.ts`:

```typescript
import { DivergenceSignal } from '../engines/divergence-engine';
import { MarketState } from '../types/market';
import { LatencyArbExecutionSnapshot } from '../strategy/latency-arb-orderbook';

export interface ShadowExecutorConfig {
  mode: 'paper' | 'shadow';
  asset: 'BTC';
  duration: '15m';
  startingBalanceUsd: number;
  orderBalanceFraction: number;
  maxOrderSizeUsd: number;
  maxPositionUsd: number;
  minConfidence: number;
}

export interface ShadowExecutorInput {
  market: MarketState;
  signal: DivergenceSignal;
  execution: LatencyArbExecutionSnapshot;
  nowMs: number;
  currentExposureUsd: number;
}

export type ShadowExecutorResult =
  | { ok: true; orderId: string; sizeUsd: number }
  | { ok: false; reason: string };

type WriteEvent = (event: Record<string, unknown>) => void;

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export class LatencyArbShadowExecutor {
  private orderCounter = 0;

  constructor(private readonly config: ShadowExecutorConfig, private readonly writeEvent: WriteEvent) {}

  evaluate(input: ShadowExecutorInput): ShadowExecutorResult {
    if (input.signal.action === 'NO_ACTION') return this.skip(input, input.signal.rejectionReason ?? 'no_action');
    if (input.signal.confidence < this.config.minConfidence) return this.skip(input, 'confidence_too_low');

    const makerPrice = input.signal.action === 'BUY_YES'
      ? input.execution.yesBestBid
      : input.execution.noBestBid;
    const takerPrice = input.signal.action === 'BUY_YES'
      ? input.execution.yesBestAsk
      : input.execution.noBestAsk;

    if (!finitePositive(makerPrice) || !finitePositive(takerPrice)) return this.skip(input, 'invalid_execution_price');

    const targetSizeUsd = Math.min(
      this.config.startingBalanceUsd * this.config.orderBalanceFraction,
      this.config.maxOrderSizeUsd
    );
    if (!finitePositive(targetSizeUsd)) return this.skip(input, 'invalid_order_size');

    if (input.currentExposureUsd + targetSizeUsd > this.config.maxPositionUsd) {
      return this.skip(input, 'position_limit_exceeded');
    }

    const orderId = `shadow-${++this.orderCounter}`;
    const shares = targetSizeUsd / makerPrice;
    const makerEvPct = ((input.signal.expectedValue + (input.signal.entryPrice - makerPrice)) / makerPrice) * 100;
    const takerEvPct = ((input.signal.expectedValue + (input.signal.entryPrice - takerPrice)) / takerPrice) * 100;

    this.writeEvent({
      eventType: 'would_place_order',
      orderId,
      timestamp: input.nowMs,
      mode: this.config.mode,
      asset: this.config.asset,
      duration: this.config.duration,
      conditionId: input.market.conditionId,
      slug: input.market.slug,
      question: input.market.question,
      action: input.signal.action,
      orderType: 'post_only_limit',
      makerPrice,
      makerEvPct,
      takerPrice,
      takerEvPct,
      sizeUsd: targetSizeUsd,
      shares,
      confidence: input.signal.confidence,
      divergencePct: input.signal.divergencePct,
      expectedValuePct: input.signal.expectedValuePct,
    });

    return { ok: true, orderId, sizeUsd: targetSizeUsd };
  }

  private skip(input: ShadowExecutorInput, reason: string): ShadowExecutorResult {
    this.writeEvent({
      eventType: 'skip',
      timestamp: input.nowMs,
      conditionId: input.market.conditionId,
      action: input.signal.action,
      reason,
    });
    return { ok: false, reason };
  }
}
```

- [ ] **Step 4: Run test to verify GREEN**

Run:

```bash
npm test -- tests/simulation/latency-arb-shadow-executor.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/latency-arb-shadow-executor.ts tests/simulation/latency-arb-shadow-executor.test.ts
git commit -m "feat(simulation): add latency arb shadow executor"
```

---

## Task 7: Add Position Tracker for Fill, MTM, and Resolution

**Files:**
- Create: `src/simulation/latency-arb-position-tracker.ts`
- Create: `tests/simulation/latency-arb-position-tracker.test.ts`

- [ ] **Step 1: Write failing position tracker tests**

Create `tests/simulation/latency-arb-position-tracker.test.ts`:

```typescript
import { LatencyArbPositionTracker, WouldOrder } from '../../src/simulation/latency-arb-position-tracker';
import { LatencyArbExecutionSnapshot } from '../../src/strategy/latency-arb-orderbook';

const order: WouldOrder = {
  orderId: 'shadow-1',
  conditionId: 'cond',
  action: 'BUY_YES',
  makerPrice: 0.44,
  sizeUsd: 1.548,
  shares: 1.548 / 0.44,
  placedAtMs: 1700000000000,
};

const execution: LatencyArbExecutionSnapshot = {
  yesBestBid: 0.45,
  yesBestAsk: 0.47,
  noBestBid: 0.53,
  noBestAsk: 0.55,
  tickSize: 0.01,
  minOrderSize: 1,
};

describe('LatencyArbPositionTracker', () => {
  it('should open maker position only after simulated latency and cross-through', () => {
    const events: Record<string, unknown>[] = [];
    const tracker = new LatencyArbPositionTracker({ simulatedLatencyMs: 750 }, (event) => events.push(event));

    expect(tracker.tryOpenFromMakerCross(order, { ...execution, yesBestAsk: 0.44 }, 1700000000500)).toBe(false);
    expect(tracker.getOpenExposureUsd()).toBe(0);

    expect(tracker.tryOpenFromMakerCross(order, { ...execution, yesBestAsk: 0.43 }, 1700000000800)).toBe(true);
    expect(tracker.getOpenExposureUsd()).toBeCloseTo(1.548, 3);
    expect(events[0]).toMatchObject({ eventType: 'position_opened', orderId: 'shadow-1' });
  });

  it('should mark YES position to market', () => {
    const events: Record<string, unknown>[] = [];
    const tracker = new LatencyArbPositionTracker({ simulatedLatencyMs: 750 }, (event) => events.push(event));

    tracker.tryOpenFromMakerCross(order, { ...execution, yesBestAsk: 0.43 }, 1700000000800);
    tracker.markToMarket('cond', execution, 1700000001000);

    expect(events[1]).toMatchObject({ eventType: 'mark_to_market', orderId: 'shadow-1' });
    expect(events[1].unrealizedPnlUsd as number).toBeGreaterThan(0);
  });

  it('should resolve winning and losing positions', () => {
    const events: Record<string, unknown>[] = [];
    const tracker = new LatencyArbPositionTracker({ simulatedLatencyMs: 750 }, (event) => events.push(event));

    tracker.tryOpenFromMakerCross(order, { ...execution, yesBestAsk: 0.43 }, 1700000000800);
    tracker.resolve('cond', 'YES', 1700000010000);

    const resolution = events.find((event) => event.eventType === 'position_resolved');
    expect(resolution).toMatchObject({ orderId: 'shadow-1', outcome: 'YES' });
    expect(resolution?.realizedPnlUsd as number).toBeGreaterThan(0);
    expect(tracker.getOpenExposureUsd()).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npm test -- tests/simulation/latency-arb-position-tracker.test.ts --runInBand
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement position tracker**

Create `src/simulation/latency-arb-position-tracker.ts`:

```typescript
import { LatencyArbExecutionSnapshot } from '../strategy/latency-arb-orderbook';

export interface WouldOrder {
  orderId: string;
  conditionId: string;
  action: 'BUY_YES' | 'BUY_NO';
  makerPrice: number;
  sizeUsd: number;
  shares: number;
  placedAtMs: number;
}

export interface LatencyArbPositionTrackerConfig {
  simulatedLatencyMs: number;
}

interface OpenPosition extends WouldOrder {
  openedAtMs: number;
}

type WriteEvent = (event: Record<string, unknown>) => void;

export class LatencyArbPositionTracker {
  private readonly pendingOrders: WouldOrder[] = [];
  private readonly openPositions: OpenPosition[] = [];

  constructor(private readonly config: LatencyArbPositionTrackerConfig, private readonly writeEvent: WriteEvent) {}

  addPendingOrder(order: WouldOrder): void {
    this.pendingOrders.push(order);
  }

  tryOpenFromMakerCross(order: WouldOrder, execution: LatencyArbExecutionSnapshot, nowMs: number): boolean {
    if (nowMs - order.placedAtMs < this.config.simulatedLatencyMs) return false;

    const crossed = order.action === 'BUY_YES'
      ? execution.yesBestAsk < order.makerPrice
      : execution.noBestAsk < order.makerPrice;
    if (!crossed) return false;

    const position: OpenPosition = { ...order, openedAtMs: nowMs };
    this.openPositions.push(position);
    this.writeEvent({
      eventType: 'position_opened',
      timestamp: nowMs,
      orderId: order.orderId,
      conditionId: order.conditionId,
      action: order.action,
      entryPrice: order.makerPrice,
      sizeUsd: order.sizeUsd,
      shares: order.shares,
    });
    return true;
  }

  processPending(executionByCondition: Map<string, LatencyArbExecutionSnapshot>, nowMs: number): void {
    for (let i = this.pendingOrders.length - 1; i >= 0; i--) {
      const order = this.pendingOrders[i];
      const execution = executionByCondition.get(order.conditionId);
      if (!execution) continue;
      if (this.tryOpenFromMakerCross(order, execution, nowMs)) {
        this.pendingOrders.splice(i, 1);
      }
    }
  }

  markToMarket(conditionId: string, execution: LatencyArbExecutionSnapshot, nowMs: number): void {
    for (const position of this.openPositions.filter((p) => p.conditionId === conditionId)) {
      const markPrice = position.action === 'BUY_YES' ? execution.yesBestBid : execution.noBestBid;
      if (!Number.isFinite(markPrice) || markPrice <= 0) {
        this.writeEvent({ eventType: 'skip', timestamp: nowMs, conditionId, reason: 'no_valid_mtm_price' });
        continue;
      }
      const markValueUsd = position.shares * markPrice;
      const unrealizedPnlUsd = markValueUsd - position.sizeUsd;
      this.writeEvent({
        eventType: 'mark_to_market',
        timestamp: nowMs,
        orderId: position.orderId,
        conditionId,
        action: position.action,
        markPrice,
        markValueUsd,
        unrealizedPnlUsd,
      });
    }
  }

  resolve(conditionId: string, outcome: 'YES' | 'NO', nowMs: number): void {
    for (let i = this.openPositions.length - 1; i >= 0; i--) {
      const position = this.openPositions[i];
      if (position.conditionId !== conditionId) continue;
      const win = (position.action === 'BUY_YES' && outcome === 'YES') ||
        (position.action === 'BUY_NO' && outcome === 'NO');
      const exitPrice = win ? 1 : 0;
      const proceedsUsd = position.shares * exitPrice;
      const realizedPnlUsd = proceedsUsd - position.sizeUsd;
      this.writeEvent({
        eventType: 'position_resolved',
        timestamp: nowMs,
        orderId: position.orderId,
        conditionId,
        action: position.action,
        outcome,
        exitPrice,
        proceedsUsd,
        realizedPnlUsd,
      });
      this.openPositions.splice(i, 1);
    }
  }

  getOpenExposureUsd(): number {
    return this.openPositions.reduce((sum, position) => sum + position.sizeUsd, 0);
  }
}
```

- [ ] **Step 4: Run test to verify GREEN**

Run:

```bash
npm test -- tests/simulation/latency-arb-position-tracker.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/latency-arb-position-tracker.ts tests/simulation/latency-arb-position-tracker.test.ts
git commit -m "feat(simulation): track latency arb shadow positions"
```

---

## Task 8: Extend Latency Arb Config and Env

**Files:**
- Modify: `src/strategy/latency-arb-config.ts`
- Modify: `src/config/env.ts`
- Modify: `.env.example`
- Modify: `tests/strategy/small-live-runner.test.ts`
- Modify: `tests/strategy/small-live-preflight.test.ts`

- [ ] **Step 1: Write failing env/config expectations**

Add assertions to `tests/strategy/latency-arb-strategy.test.ts` or create a small config test `tests/strategy/latency-arb-config.test.ts`:

```typescript
import { defaultLatencyArbConfig } from '../../src/strategy/latency-arb-config';

describe('defaultLatencyArbConfig live-like shadow fields', () => {
  it('should default to BTC 15m shadow soak settings', () => {
    expect(defaultLatencyArbConfig.marketAsset).toBe('BTC');
    expect(defaultLatencyArbConfig.marketDurationMinutes).toBe(15);
    expect(defaultLatencyArbConfig.startingBalanceUsd).toBe(15.48);
    expect(defaultLatencyArbConfig.orderBalanceFraction).toBe(0.1);
    expect(defaultLatencyArbConfig.maxOrderSizeUsd).toBe(1.55);
    expect(defaultLatencyArbConfig.maxSpreadCents).toBe(8);
    expect(defaultLatencyArbConfig.maxMarketAgeMs).toBe(2000);
    expect(defaultLatencyArbConfig.simulatedLatencyMs).toBe(750);
    expect(defaultLatencyArbConfig.logDir).toBe('logs');
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npm test -- tests/strategy/latency-arb-config.test.ts --runInBand
```

Expected: FAIL because fields do not exist.

- [ ] **Step 3: Add config fields**

Update `src/strategy/latency-arb-config.ts` interface:

```typescript
  marketAsset: 'BTC';
  marketDurationMinutes: number;
  startingBalanceUsd: number;
  orderBalanceFraction: number;
  maxOrderSizeUsd: number;
  maxSpreadCents: number;
  maxMarketAgeMs: number;
  simulatedLatencyMs: number;
  logDir: string;
```

Add defaults:

```typescript
  marketAsset: 'BTC',
  marketDurationMinutes: 15,
  startingBalanceUsd: 15.48,
  orderBalanceFraction: 0.10,
  maxOrderSizeUsd: 1.55,
  maxSpreadCents: 8,
  maxMarketAgeMs: 2000,
  simulatedLatencyMs: 750,
  logDir: 'logs',
```

Update `EnvConfig` in `src/config/env.ts`:

```typescript
  latencyArbMarketAsset: 'BTC';
  latencyArbMarketDurationMinutes: number;
  latencyArbStartingBalanceUsd: number;
  latencyArbOrderBalanceFraction: number;
  latencyArbMaxOrderSizeUsd: number;
  latencyArbMaxSpreadCents: number;
  latencyArbMaxMarketAgeMs: number;
  latencyArbSimulatedLatencyMs: number;
  latencyArbLogDir: string;
```

Add parser helper:

```typescript
function getEnvLatencyAsset(key: string, defaultValue: 'BTC'): 'BTC' {
  const val = process.env[key];
  if (val === undefined) return defaultValue;
  if (val === 'BTC') return val;
  throw new Error(`Invalid latency arb asset for ${key}: ${val}`);
}
```

Add env values:

```typescript
  latencyArbMarketAsset: getEnvLatencyAsset('LATENCY_ARB_MARKET_ASSET', 'BTC'),
  latencyArbMarketDurationMinutes: getEnvInt('LATENCY_ARB_MARKET_DURATION_MINUTES', 15),
  latencyArbStartingBalanceUsd: getEnvFloat('LATENCY_ARB_STARTING_BALANCE_USD', 15.48),
  latencyArbOrderBalanceFraction: getEnvFloat('LATENCY_ARB_ORDER_BALANCE_FRACTION', 0.10),
  latencyArbMaxOrderSizeUsd: getEnvFloat('LATENCY_ARB_MAX_ORDER_SIZE_USD', 1.55),
  latencyArbMaxSpreadCents: getEnvFloat('LATENCY_ARB_MAX_SPREAD_CENTS', 8),
  latencyArbMaxMarketAgeMs: getEnvInt('LATENCY_ARB_MAX_MARKET_AGE_MS', 2000),
  latencyArbSimulatedLatencyMs: getEnvInt('LATENCY_ARB_SIMULATED_LATENCY_MS', 750),
  latencyArbLogDir: getEnv('LATENCY_ARB_LOG_DIR', 'logs'),
```

Update fixtures in `tests/strategy/small-live-runner.test.ts` and `tests/strategy/small-live-preflight.test.ts` by adding the same fields to any `EnvConfig` object literals.

Update `.env.example`:

```bash
LATENCY_ARB_MARKET_ASSET=BTC
LATENCY_ARB_MARKET_DURATION_MINUTES=15
LATENCY_ARB_STARTING_BALANCE_USD=15.48
LATENCY_ARB_ORDER_BALANCE_FRACTION=0.10
LATENCY_ARB_MAX_ORDER_SIZE_USD=1.55
LATENCY_ARB_MAX_SPREAD_CENTS=8
LATENCY_ARB_MAX_MARKET_AGE_MS=2000
LATENCY_ARB_SIMULATED_LATENCY_MS=750
LATENCY_ARB_LOG_DIR=logs
```

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
npm test -- tests/strategy/latency-arb-config.test.ts tests/strategy/small-live-runner.test.ts tests/strategy/small-live-preflight.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/strategy/latency-arb-config.ts src/config/env.ts .env.example tests/strategy/latency-arb-config.test.ts tests/strategy/small-live-runner.test.ts tests/strategy/small-live-preflight.test.ts
git commit -m "feat(config): add latency arb shadow soak settings"
```

---

## Task 9: Wire Runtime Path and Hard-Block small_live

**Files:**
- Modify: `src/strategy/latency-arb-strategy.ts`
- Modify: `src/run-latency-arb.ts`
- Create: `tests/integration/latency-arb-runtime.test.ts`

- [ ] **Step 1: Write failing runner integration test**

Create `tests/integration/latency-arb-runtime.test.ts` to test the core injectable runtime helper. If the implementation extracts a helper named `runLatencyArbCycle`, the test should use that helper:

```typescript
import { assertLatencyArbModeAllowed, runLatencyArbCycle } from '../../src/run-latency-arb';
import { LatencyArbConfig } from '../../src/strategy/latency-arb-config';
import { MarketState } from '../../src/types/market';
import { BookState } from '../../src/types/book';

const now = 1700000000000;

const config: LatencyArbConfig = {
  symbols: ['btcusdt'],
  binanceWsUrl: 'wss://stream.binance.com:9443',
  lookbackSeconds: 60,
  minPriceChangePct: 0.5,
  minVolumeMultiplier: 1.5,
  emaFastPeriod: 5,
  emaSlowPeriod: 20,
  minDivergencePct: 3,
  minEvPct: 2,
  maxEntryPrice: 0.7,
  minEntryPrice: 0.2,
  minConfidence: 0.6,
  maxPositionSizeUsd: 1.55,
  maxDailyTrades: 20,
  cooldownMs: 0,
  mode: 'shadow',
  marketAsset: 'BTC',
  marketDurationMinutes: 15,
  startingBalanceUsd: 15.48,
  orderBalanceFraction: 0.1,
  maxOrderSizeUsd: 1.55,
  maxSpreadCents: 8,
  maxMarketAgeMs: 2000,
  simulatedLatencyMs: 750,
  logDir: 'logs',
};

function market(): MarketState {
  return {
    conditionId: 'cond-btc-15',
    slug: 'bitcoin-up-or-down-15m',
    question: 'Bitcoin Up or Down - 15m',
    yesTokenId: 'yes',
    noTokenId: 'no',
    active: true,
    closed: false,
    enableOrderBook: true,
    feesEnabled: true,
    endDate: new Date(now + 10 * 60_000).toISOString(),
    volume24hUsd: 1000,
    liquidityUsd: 1000,
    oracleAmbiguityScore: 0.05,
  };
}

function book(tokenId: string, bid: number, ask: number): BookState {
  return {
    tokenId,
    conditionId: 'cond-btc-15',
    bids: [],
    asks: [],
    bestBid: bid,
    bestAsk: ask,
    bestBidSizeUsd: 100,
    bestAskSizeUsd: 100,
    midpoint: (bid + ask) / 2,
    spread: ask - bid,
    spreadTicks: Math.round((ask - bid) / 0.01),
    depth1Usd: 200,
    depth3Usd: 500,
    tickSize: 0.01,
    minOrderSize: 1,
    lastUpdateMs: now,
  };
}

describe('latency arb runtime cycle', () => {
  it('should discover BTC 15m market, analyze signal, and write would-order event', async () => {
    const events: Record<string, unknown>[] = [];
    const momentum = {
      direction: 'BULLISH' as const,
      strength: 1,
      priceChangePct: 2,
      volumeConfirmed: true,
      emaFast: 51000,
      emaSlow: 50000,
      timestamp: now,
    };

    await runLatencyArbCycle({
      nowMs: now,
      config,
      getMomentum: () => momentum,
      fetchMarkets: async () => [market()],
      fetchBook: async (_conditionId, tokenId) => tokenId === 'yes' ? book('yes', 0.44, 0.46) : book('no', 0.54, 0.56),
      writeEvent: (event) => events.push(event),
      currentExposureUsd: () => 0,
    });

    expect(events.some((event) => event.eventType === 'signal')).toBe(true);
    expect(events.some((event) => event.eventType === 'would_place_order')).toBe(true);
  });

  it('should write skip when no BTC 15m market is found', async () => {
    const events: Record<string, unknown>[] = [];

    await runLatencyArbCycle({
      nowMs: now,
      config,
      getMomentum: () => null,
      fetchMarkets: async () => [],
      fetchBook: async () => { throw new Error('should not fetch book'); },
      writeEvent: (event) => events.push(event),
      currentExposureUsd: () => 0,
    });

    expect(events[0]).toMatchObject({ eventType: 'skip', reason: 'no_eligible_btc_15m_market' });
  });

  it('should hard-block small_live mode', () => {
    expect(() => assertLatencyArbModeAllowed('small_live')).toThrow('Latency arb live mode is disabled');
    expect(() => assertLatencyArbModeAllowed('shadow')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npm test -- tests/integration/latency-arb-runtime.test.ts --runInBand
```

Expected: FAIL because exported helpers do not exist.

- [ ] **Step 3: Implement runtime helper and runner wiring**

Update `src/strategy/latency-arb-strategy.ts` config interface to include `binanceWsUrl?: string`, and in `start()` pass it:

```typescript
this.feed = new BinanceWsFeed({
  symbols: this.config.symbols,
  wsBaseUrl: this.config.binanceWsUrl,
  onPriceUpdate: this.onPriceUpdate.bind(this),
  onError: (err) => console.error('[LatencyArb] Feed error:', err),
});
```

Add `binanceWsUrl: string` to `LatencyArbConfig` and default it to Binance URL.

Update `src/run-latency-arb.ts` to export helpers and guard main execution:

```typescript
import 'dotenv/config';
import { env, EnvConfig } from './config/env';
import { LatencyArbStrategy } from './strategy/latency-arb-strategy';
import { ConsoleLogger } from './utils/logger';
import { GammaApiScanner } from './data/gamma-market-scanner';
import { ClobApiClient } from './data/clob-orderbook-client';
import { JsonlEventWriter } from './accounting/jsonl-event-writer';
import { selectLatencyArbMarkets } from './strategy/latency-arb-market-selector';
import { buildLatencyArbSnapshot } from './strategy/latency-arb-orderbook';
import { LatencyArbShadowExecutor } from './simulation/latency-arb-shadow-executor';
import { LatencyArbPositionTracker } from './simulation/latency-arb-position-tracker';
import { LatencyArbConfig } from './strategy/latency-arb-config';
import { MarketState } from './types/market';
import { BookState } from './types/book';
import { MomentumSignal } from './engines/momentum-engine';
import { analyzeDivergence } from './engines/divergence-engine';

const logger = new ConsoleLogger();

export function assertLatencyArbModeAllowed(mode: EnvConfig['mode']): void {
  if (mode === 'small_live') {
    throw new Error('Latency arb live mode is disabled until shadow soak is reviewed');
  }
}

export interface RunLatencyArbCycleDeps {
  nowMs: number;
  config: LatencyArbConfig;
  getMomentum: (symbol: string) => MomentumSignal | null;
  fetchMarkets: () => Promise<MarketState[]>;
  fetchBook: (conditionId: string, tokenId: string) => Promise<BookState>;
  writeEvent: (event: Record<string, unknown>) => void;
  currentExposureUsd: () => number;
}

export async function runLatencyArbCycle(deps: RunLatencyArbCycleDeps): Promise<void> {
  const markets = selectLatencyArbMarkets(await deps.fetchMarkets(), {
    asset: deps.config.marketAsset,
    durationMinutes: deps.config.marketDurationMinutes,
    maxMarkets: 1,
    nowMs: deps.nowMs,
  });

  if (markets.length === 0) {
    deps.writeEvent({ eventType: 'skip', timestamp: deps.nowMs, reason: 'no_eligible_btc_15m_market' });
    return;
  }

  const market = markets[0];
  const momentum = deps.getMomentum('btcusdt');
  if (!momentum) {
    deps.writeEvent({ eventType: 'skip', timestamp: deps.nowMs, conditionId: market.conditionId, reason: 'no_momentum_signal' });
    return;
  }

  const yesBook = await deps.fetchBook(market.conditionId, market.yesTokenId);
  const noBook = await deps.fetchBook(market.conditionId, market.noTokenId);
  const snapshotResult = buildLatencyArbSnapshot({ yes: yesBook, no: noBook }, {
    nowMs: deps.nowMs,
    maxMarketAgeMs: deps.config.maxMarketAgeMs,
    maxSpreadCents: deps.config.maxSpreadCents,
  });
  if (!snapshotResult.ok) {
    deps.writeEvent({ eventType: 'skip', timestamp: deps.nowMs, conditionId: market.conditionId, reason: snapshotResult.reason });
    return;
  }

  const signal = analyzeDivergence({
    minDivergencePct: deps.config.minDivergencePct,
    minEvPct: deps.config.minEvPct,
    maxEntryPrice: deps.config.maxEntryPrice,
    minEntryPrice: deps.config.minEntryPrice,
  }, momentum, snapshotResult.snapshot, () => deps.nowMs);

  deps.writeEvent({
    eventType: 'signal',
    timestamp: deps.nowMs,
    conditionId: market.conditionId,
    action: signal.action,
    confidence: signal.confidence,
    divergencePct: signal.divergencePct,
    expectedValuePct: signal.expectedValuePct,
    rejectionReason: signal.rejectionReason,
  });

  const executor = new LatencyArbShadowExecutor({
    mode: deps.config.mode === 'paper' ? 'paper' : 'shadow',
    asset: deps.config.marketAsset,
    duration: '15m',
    startingBalanceUsd: deps.config.startingBalanceUsd,
    orderBalanceFraction: deps.config.orderBalanceFraction,
    maxOrderSizeUsd: deps.config.maxOrderSizeUsd,
    maxPositionUsd: deps.config.maxPositionSizeUsd,
    minConfidence: deps.config.minConfidence,
  }, deps.writeEvent);

  executor.evaluate({
    market,
    signal,
    execution: snapshotResult.execution,
    nowMs: deps.nowMs,
    currentExposureUsd: deps.currentExposureUsd(),
  });
}
```

In `main()`, call `assertLatencyArbModeAllowed(env.mode)` after the enabled check. Wire dependencies:

```typescript
const writer = new JsonlEventWriter({
  logDir: env.latencyArbLogDir,
  filePrefix: 'latency-arb-orders',
  onError: (error) => logger.error('Failed to write latency arb event', { error: error.message }),
});
const scanner = new GammaApiScanner();
const bookClient = new ClobApiClient();
const positionTracker = new LatencyArbPositionTracker({ simulatedLatencyMs: env.latencyArbSimulatedLatencyMs }, (event) => writer.write(event));
```

Create `LatencyArbStrategy` with all env/config fields, including `binanceWsUrl`.

After `strategy.start()`, set an interval:

```typescript
setInterval(() => {
  runLatencyArbCycle({
    nowMs: Date.now(),
    config: strategy.getConfig(),
    getMomentum: (symbol) => strategy.getMomentum(symbol),
    fetchMarkets: () => scanner.fetchMarkets(),
    fetchBook: (conditionId, tokenId) => bookClient.fetchBook(conditionId, tokenId),
    writeEvent: (event) => writer.write(event),
    currentExposureUsd: () => positionTracker.getOpenExposureUsd(),
  }).catch((error) => logger.error('Latency arb cycle failed', { error: String(error) }));
}, 5000);
```

If `LatencyArbStrategy` does not yet expose config, add:

```typescript
getConfig(): LatencyArbConfig {
  return { ...this.config };
}
```

Guard main execution so tests importing helpers do not start the runner:

```typescript
if (require.main === module) {
  main().catch(err => {
    logger.error('Fatal error', { error: String(err) });
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run test to verify GREEN**

Run:

```bash
npm test -- tests/integration/latency-arb-runtime.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Run focused latency tests**

Run:

```bash
npm test -- tests/data/binance-ws-feed.test.ts tests/engines/divergence-engine.test.ts tests/strategy/latency-arb-market-selector.test.ts tests/strategy/latency-arb-orderbook.test.ts tests/accounting/jsonl-event-writer.test.ts tests/simulation/latency-arb-shadow-executor.test.ts tests/simulation/latency-arb-position-tracker.test.ts tests/integration/latency-arb-runtime.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/strategy/latency-arb-strategy.ts src/run-latency-arb.ts tests/integration/latency-arb-runtime.test.ts
git commit -m "feat(strategy): wire latency arb shadow runtime"
```

---

## Task 10: Documentation Updates and Final Verification

**Files:**
- Modify: `docs/latency-arbitrage.md`
- Modify: `README.md`
- Optionally modify: `docs/superpowers/plans/2026-06-01-latency-arbitrage-strategy.md` if it remains untracked and should be kept.

- [ ] **Step 1: Update docs to shadow-only truth**

In `docs/latency-arbitrage.md`, replace claims that the strategy buys real tokens with wording like:

```markdown
The current production-safe mode is live-like shadow: the bot discovers BTC 15m markets, computes would-live post-only orders, and writes them to JSONL. It does not submit real orders. `MODE=small_live` is explicitly blocked for latency-arb until a separate live phase is approved.
```

Add soak instructions:

```bash
LATENCY_ARB_ENABLED=true \
MODE=shadow \
LIVE_TRADING_ENABLED=false \
LATENCY_ARB_MARKET_ASSET=BTC \
LATENCY_ARB_MARKET_DURATION_MINUTES=15 \
LATENCY_ARB_STARTING_BALANCE_USD=15.48 \
LATENCY_ARB_ORDER_BALANCE_FRACTION=0.10 \
LATENCY_ARB_MAX_ORDER_SIZE_USD=1.55 \
npm run start:latency-arb
```

Document JSONL path:

```markdown
Logs are written to `logs/latency-arb-orders-YYYY-MM-DD.jsonl`.
```

In `README.md`, adjust latency-arb section to say shadow-only/live-like would-orders, not live execution.

- [ ] **Step 2: Decide untracked original plan file**

Run:

```bash
git status --short
```

If `docs/superpowers/plans/2026-06-01-latency-arbitrage-strategy.md` is still untracked and useful historical context, add and commit it. If it is obsolete and the new plan supersedes it, remove it with:

```bash
rm docs/superpowers/plans/2026-06-01-latency-arbitrage-strategy.md
```

Do not leave it untracked before final handoff.

- [ ] **Step 3: Run full verification**

Run:

```bash
npm run build
npm test -- --runInBand
LATENCY_ARB_ENABLED=false npm run start:latency-arb
```

Expected:

- build passes
- all tests pass
- disabled runner exits with disabled message

- [ ] **Step 4: Run small_live hard-block smoke check**

Run:

```bash
LATENCY_ARB_ENABLED=true MODE=small_live npm run start:latency-arb
```

Expected: exits non-zero with message containing `Latency arb live mode is disabled` and submits no orders.

- [ ] **Step 5: Commit docs/final cleanup**

```bash
git add docs/latency-arbitrage.md README.md docs/superpowers/plans/2026-06-01-latency-arb-live-like-shadow-plan.md
# If keeping the old plan, include it too. If removing it, git add -u docs/superpowers/plans/.
git commit -m "docs: document latency arb shadow soak workflow"
```

---

## Final Review Gate

After Task 10, request fresh-context review with these angles before any production deploy:

1. Correctness/regressions.
2. Risk controls and live-trading safety.
3. Tests/validation quality.
4. Simplicity/API consistency.

Acceptance criteria before deployment:

- `MODE=small_live` latency-arb is hard-blocked.
- No code path calls a live order submitter from latency-arb.
- JSONL would-orders are produced in shadow mode with fixture/integration tests.
- Build and full tests pass.
- Docs accurately say shadow-only and no real orders.
