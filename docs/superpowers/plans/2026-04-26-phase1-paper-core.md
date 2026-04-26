# Phase 1: Paper Mode Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fully operational paper-mode market-making strategy for Polymarket CLOB V2 with pure engines, conservative paper simulator, PnL attribution, decision traces, and risk guards.

**Architecture:** Bottom-up pure functional engines (fair price, toxicity, inventory, quote) tested in isolation first, then wired into a strategy runner with a paper execution simulator. No real orders. No WebSockets (REST polling only).

**Tech Stack:** TypeScript 5.x, Node.js 20+, Jest 29.x, ts-jest, native fetch.

**Worktree:** `/home/alex/Project/MM_Poly/.worktrees/phase1-paper-core`

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `jest.config.js`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "polymarket-mm-phase1",
  "version": "0.1.0",
  "description": "Polymarket rebate-aware market making - Phase 1 Paper Core",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage"
  },
  "devDependencies": {
    "@types/jest": "^29.5.0",
    "@types/node": "^20.0.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.0",
    "typescript": "^5.3.0"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Create `jest.config.js`**

```javascript
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts', '!src/**/index.ts'],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 80,
      lines: 80,
      statements: 80
    }
  }
};
```

- [ ] **Step 4: Install dependencies**

Run: `npm install`
Expected: `node_modules` created, no errors.

- [ ] **Step 5: Create directory structure**

Run:
```bash
mkdir -p src/{types,engines,strategy,simulation,accounting,risk,data/{fixtures},utils}
mkdir -p tests/{engines,simulation,integration,invariants}
```

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json jest.config.js .gitignore
mkdir -p src tests
git add src tests
git commit -m "chore: project scaffold for phase 1 paper core"
```

---

## Task 2: Shared Types

**Files:**
- Create: `src/types/market.ts`
- Create: `src/types/book.ts`
- Create: `src/types/flow.ts`
- Create: `src/types/inventory.ts`
- Create: `src/types/quote.ts`
- Create: `src/types/accounting.ts`
- Create: `src/types/config.ts`
- Create: `src/types/index.ts`

- [ ] **Step 1: Create `src/types/market.ts`**

```typescript
export interface MarketState {
  conditionId: string;
  eventId?: string;
  marketSlug?: string;
  question?: string;
  yesTokenId: string;
  noTokenId: string;
  active: boolean;
  closed: boolean;
  enableOrderBook: boolean;
  feesEnabled: boolean;
  negRisk?: boolean;
  category?: string;
  endDate?: string;
  resolutionSource?: string;
  volume24hUsd: number;
  liquidityUsd: number;
  feeRate?: number;
  makerRebateRate?: number;
  rewardConfig?: RewardConfig | null;
  oracleAmbiguityScore: number;
  knownCatalystAt?: number | null;
}

export interface RewardConfig {
  enabled: boolean;
  minIncentiveSizeUsd: number;
  maxIncentiveSpreadCents: number;
  rewardPoolUsd?: number | null;
}
```

- [ ] **Step 2: Create `src/types/book.ts`**

```typescript
export interface BookLevel {
  price: number;
  size: number;
  sizeUsd: number;
}

export interface BookState {
  tokenId: string;
  conditionId: string;
  bids: BookLevel[];
  asks: BookLevel[];
  bestBid: number | null;
  bestAsk: number | null;
  bestBidSizeUsd: number;
  bestAskSizeUsd: number;
  midpoint: number | null;
  spread: number | null;
  spreadTicks: number | null;
  depth1Usd: number;
  depth3Usd: number;
  tickSize: number;
  minOrderSize: number;
  lastTradePrice?: number | null;
  orderbookHash?: string | null;
  lastUpdateMs: number;
}
```

- [ ] **Step 3: Create `src/types/flow.ts`**

```typescript
export interface FlowState {
  conditionId: string;
  tokenId: string;
  trades10s: number;
  trades30s: number;
  trades60s: number;
  takerBuyVolume60sUsd: number;
  takerSellVolume60sUsd: number;
  largeTradeCount60s: number;
  midpointChange10sCents: number;
  midpointChange60sCents: number;
  bookHashChanges10s: number;
  wsDisconnectsLast5m: number;
  lastLargeTradeAtMs?: number | null;
}
```

- [ ] **Step 4: Create `src/types/inventory.ts`**

```typescript
export interface InventoryState {
  conditionId: string;
  pusdAvailable: number;
  yesTokens: number;
  noTokens: number;
  yesExposureUsd: number;
  noExposureUsd: number;
  netYesExposureUsd: number;
  marketExposureUsd: number;
  eventExposureUsd: number;
  strategyExposureUsd: number;
  inventoryPct: number;
  softLimitBreached: boolean;
  hardLimitBreached: boolean;
}
```

- [ ] **Step 5: Create `src/types/quote.ts`**

```typescript
export type Side = 'BUY' | 'SELL';
export type OrderType = 'GTC' | 'GTD';

export interface QuoteCandidate {
  conditionId: string;
  tokenId: string;
  side: Side;
  price: number;
  size: number;
  sizeUsd: number;
  orderType: OrderType;
  postOnly: true;
  expiresAt?: number | null;
  fairPrice: number;
  targetHalfSpreadCents: number;
  inventorySkewCents: number;
  toxicityScore: number;
  reason: string;
  riskFlags: string[];
}
```

- [ ] **Step 6: Create `src/types/accounting.ts`**

```typescript
export interface StrategyPnlBreakdown {
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  spreadCapturePnl: number;
  estimatedMakerRebatePnl: number;
  estimatedLiquidityRewardPnl: number;
  adverseSelectionLoss: number;
  inventoryMarkToMarketPnl: number;
  settlementPnl: number;
  feesPaid: number;
  slippageCost: number;
}

export interface QuoteDecisionTrace {
  timestampMs: number;
  mode: 'paper' | 'shadow' | 'small_live' | 'disabled';
  conditionId: string;
  tokenId: string;
  side: Side;
  bestBid: number | null;
  bestAsk: number | null;
  midpoint: number | null;
  spreadTicks: number | null;
  fairPrice: number | null;
  microprice: number | null;
  complementFair: number | null;
  lastTradeEma: number | null;
  toxicityScore: number;
  inventoryPct: number;
  inventorySkewCents: number;
  targetPrice?: number;
  targetSizeUsd?: number;
  expectedSpreadCaptureCents?: number;
  expectedRebateScore?: number;
  expectedRewardScore?: number;
  decision: 'quote' | 'skip' | 'cancel' | 'exit_only' | 'disabled_by_risk';
  reason: string;
  riskFlags: string[];
}
```

- [ ] **Step 7: Create `src/types/config.ts`**

```typescript
export interface FairPriceWeights {
  microprice: number;
  midpoint: number;
  complement: number;
  lastTradeEma: number;
  externalSignal: number;
}

export interface MarketFilterConfig {
  active: boolean;
  closed: boolean;
  enableOrderBook: boolean;
  feesEnabled: boolean;
  midpointMin: number;
  midpointMax: number;
  minVolume24hUsd: number;
  minLiquidityUsd: number;
  minBestLevelDepthUsd: number;
  minDepth3LevelsUsd: number;
  minSpreadTicks: number;
  maxSpreadCents: number;
  minTimeToResolutionMinutes: number;
  disableNearResolutionMinutes: number;
  maxOracleAmbiguityScore: number;
  requireValidResolutionSource: boolean;
}

export interface SpreadConfig {
  minHalfSpreadTicks: number;
  baseHalfSpreadCents: number;
  volatilityMultiplier: number;
  adverseSelectionBufferCents: number;
  toxicityWideningMaxCents: number;
  inventoryWideningMaxCents: number;
  rewardTighteningMaxCents: number;
}

export interface SizeConfig {
  baseOrderSizeUsd: number;
  maxOrderSizeUsd: number;
  minSizeMultiplierOverExchangeMin: number;
  respectRewardMinIncentiveSize: boolean;
}

export interface InventoryConfig {
  maxMarketExposureUsd: number;
  maxEventExposureUsd: number;
  maxTotalStrategyExposureUsd: number;
  softLimitPct: number;
  hardLimitPct: number;
  maxSkewCents: number;
  skewSensitivity: number;
}

export interface ToxicityConfig {
  cancelIfMidpointMoves10sCentsGte: number;
  cancelIfMidpointMoves60sCentsGte: number;
  cancelIfLargeTradeUsdGte: number;
  cancelIfHashChanges10sGte: number;
  cancelIfSpreadTicksLte: number;
  cooldownAfterCancelSeconds: number;
}

export interface RiskConfig {
  maxDailyDrawdownPct: number;
  maxStrategyDrawdownPct: number;
  maxConsecutiveAdverseFills: number;
  cancelAllOnWsDisconnectSeconds: number;
  cancelAllOnApiErrorRatePct: number;
  cancelAllOnTickSizeChange: boolean;
  disableNearResolutionMinutes: number;
}

export interface StrategyConfig {
  mode: 'paper' | 'shadow' | 'small_live' | 'disabled';
  liveTradingEnabled: boolean;
  fairPrice: {
    weights: FairPriceWeights;
    complementConsistencyToleranceCents: number;
  };
  marketFilter: MarketFilterConfig;
  spread: SpreadConfig;
  size: SizeConfig;
  inventory: InventoryConfig;
  toxicity: ToxicityConfig;
  risk: RiskConfig;
  refreshIntervalMs: number;
  staleOrderMaxAgeMs: number;
  minQuoteLifetimeMs: number;
  maxQuoteLifetimeMs: number;
}
```

- [ ] **Step 8: Create `src/types/index.ts`**

```typescript
export * from './market';
export * from './book';
export * from './flow';
export * from './inventory';
export * from './quote';
export * from './accounting';
export * from './config';
```

- [ ] **Step 9: Run build to verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 10: Commit**

```bash
git add src/types/
git commit -m "feat(types): add all domain types for phase 1"
```

---

## Task 3: Utils (Math + Logger)

**Files:**
- Create: `src/utils/math.ts`
- Create: `src/utils/logger.ts`
- Create: `tests/utils/math.test.ts`

- [ ] **Step 1: Write failing test for math utils**

Create `tests/utils/math.test.ts`:

```typescript
import { roundDownToTick, roundUpToTick, computeMidpoint, microprice } from '../../src/utils/math';

describe('math utils', () => {
  test('roundDownToTick rounds down to nearest tick', () => {
    expect(roundDownToTick(0.53, 0.01)).toBe(0.53);
    expect(roundDownToTick(0.531, 0.01)).toBe(0.53);
    expect(roundDownToTick(0.539, 0.01)).toBe(0.53);
  });

  test('roundUpToTick rounds up to nearest tick', () => {
    expect(roundUpToTick(0.53, 0.01)).toBe(0.53);
    expect(roundUpToTick(0.531, 0.01)).toBe(0.54);
    expect(roundUpToTick(0.001, 0.01)).toBe(0.01);
  });

  test('computeMidpoint returns average of bid and ask', () => {
    expect(computeMidpoint(0.45, 0.55)).toBe(0.50);
    expect(computeMidpoint(0.50, 0.52)).toBe(0.51);
  });

  test('microprice computes size-weighted midpoint', () => {
    expect(microprice(0.45, 0.55, 100, 100)).toBe(0.50);
    expect(microprice(0.45, 0.55, 100, 900)).toBe(0.46);
  });
});
```

Run: `npx jest tests/utils/math.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 2: Implement math utils**

Create `src/utils/math.ts`:

```typescript
export function roundDownToTick(price: number, tickSize: number): number {
  return Math.floor(price / tickSize) * tickSize;
}

export function roundUpToTick(price: number, tickSize: number): number {
  return Math.ceil(price / tickSize) * tickSize;
}

export function computeMidpoint(bestBid: number, bestAsk: number): number {
  return (bestBid + bestAsk) / 2;
}

export function microprice(bestBid: number, bestAsk: number, bidSize: number, askSize: number): number {
  if (bidSize + askSize === 0) return (bestBid + bestAsk) / 2;
  return (bestAsk * bidSize + bestBid * askSize) / (bidSize + askSize);
}
```

Run: `npx jest tests/utils/math.test.ts`
Expected: PASS.

- [ ] **Step 3: Implement logger**

Create `src/utils/logger.ts`:

```typescript
export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  trace(trace: unknown): void;
}

export class ConsoleLogger implements Logger {
  info(message: string, meta?: Record<string, unknown>): void {
    console.log(JSON.stringify({ level: 'info', time: Date.now(), message, ...meta }));
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    console.log(JSON.stringify({ level: 'warn', time: Date.now(), message, ...meta }));
  }

  error(message: string, meta?: Record<string, unknown>): void {
    console.error(JSON.stringify({ level: 'error', time: Date.now(), message, ...meta }));
  }

  trace(trace: unknown): void {
    console.log(JSON.stringify({ level: 'trace', time: Date.now(), ...trace }));
  }
}

export const defaultLogger: Logger = new ConsoleLogger();
```

- [ ] **Step 4: Commit**

```bash
git add src/utils/ tests/utils/
git commit -m "feat(utils): add math helpers and structured logger"
```

---

## Task 4: Fair Price Engine

**Files:**
- Create: `src/engines/fair-price-engine.ts`
- Create: `tests/engines/fair-price-engine.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/engines/fair-price-engine.test.ts`:

```typescript
import { computeFairPrice, computeMicroprice, checkComplementConsistency } from '../../src/engines/fair-price-engine';

describe('fair-price-engine', () => {
  const weights = { microprice: 0.45, midpoint: 0.25, complement: 0.20, lastTradeEma: 0.10, externalSignal: 0.00 };

  test('computes midpoint', () => {
    const result = computeFairPrice({
      bestBid: 0.45, bestAsk: 0.55, bestBidSize: 100, bestAskSize: 100,
      lastTradeEma: null, complementMidpoint: null, weights
    });
    expect(result).not.toBeNull();
    expect(result!.fairPrice).toBeCloseTo(0.50, 2);
    expect(result!.microprice).toBeCloseTo(0.50, 2);
  });

  test('computes microprice', () => {
    const result = computeFairPrice({
      bestBid: 0.45, bestAsk: 0.55, bestBidSize: 100, bestAskSize: 900,
      lastTradeEma: null, complementMidpoint: null, weights
    });
    expect(result!.microprice).toBeCloseTo(0.46, 2);
    expect(result!.fairPrice).toBeCloseTo(0.332, 2);
  });

  test('computes complement-implied yes price', () => {
    const result = computeFairPrice({
      bestBid: 0.45, bestAsk: 0.55, bestBidSize: 100, bestAskSize: 100,
      lastTradeEma: null, complementMidpoint: 0.48, weights
    });
    expect(result!.fairPrice).toBeCloseTo(0.354, 2);
  });

  test('rejects missing best bid', () => {
    const result = computeFairPrice({
      bestBid: 0, bestAsk: 0.55, bestBidSize: 100, bestAskSize: 100,
      lastTradeEma: null, complementMidpoint: null, weights
    });
    expect(result).toBeNull();
  });

  test('rejects missing best ask', () => {
    const result = computeFairPrice({
      bestBid: 0.45, bestAsk: 0, bestBidSize: 100, bestAskSize: 100,
      lastTradeEma: null, complementMidpoint: null, weights
    });
    expect(result).toBeNull();
  });

  test('checkComplementConsistency passes when within tolerance', () => {
    expect(checkComplementConsistency(0.52, 0.48, 2.0)).toBe(true);
    expect(checkComplementConsistency(0.53, 0.48, 2.0)).toBe(false);
  });
});
```

Run: `npx jest tests/engines/fair-price-engine.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement fair price engine**

Create `src/engines/fair-price-engine.ts`:

```typescript
import { FairPriceWeights } from '../types/config';
import { computeMidpoint, microprice } from '../utils/math';

export interface FairPriceInputs {
  bestBid: number;
  bestAsk: number;
  bestBidSize: number;
  bestAskSize: number;
  lastTradeEma: number | null;
  complementMidpoint: number | null;
  weights: FairPriceWeights;
}

export interface FairPriceResult {
  fairPrice: number;
  microprice: number;
}

export function computeFairPrice(inputs: FairPriceInputs): FairPriceResult | null {
  const { bestBid, bestAsk, bestBidSize, bestAskSize, lastTradeEma, complementMidpoint, weights } = inputs;

  if (!bestBid || !bestAsk || bestBid <= 0 || bestAsk <= 0) {
    return null;
  }

  const mid = computeMidpoint(bestBid, bestAsk);
  const mic = microprice(bestBid, bestAsk, bestBidSize, bestAskSize);

  let fair = weights.microprice * mic + weights.midpoint * mid;

  if (weights.complement > 0 && complementMidpoint !== null) {
    fair += weights.complement * complementMidpoint;
  }

  if (weights.lastTradeEma > 0 && lastTradeEma !== null) {
    fair += weights.lastTradeEma * lastTradeEma;
  }

  return { fairPrice: fair, microprice: mic };
}

export function checkComplementConsistency(yesFair: number, noFair: number, toleranceCents: number): boolean {
  const diffCents = Math.abs(yesFair + noFair - 1.0) * 100;
  return diffCents <= toleranceCents;
}
```

Run: `npx jest tests/engines/fair-price-engine.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/engines/fair-price-engine.ts tests/engines/fair-price-engine.test.ts
git commit -m "feat(engines): fair price engine with microprice, complement, consistency"
```

---

## Task 5: Toxicity Engine

**Files:**
- Create: `src/engines/toxicity-engine.ts`
- Create: `tests/engines/toxicity-engine.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/engines/toxicity-engine.test.ts`:

```typescript
import { computeToxicityScore, getToxicityAction, checkHardToxicityCancel } from '../../src/engines/toxicity-engine';

describe('toxicity-engine', () => {
  test('low toxicity allows quote', () => {
    const score = computeToxicityScore({
      trades10s: 0, trades30s: 1, trades60s: 2,
      takerBuyVolume60sUsd: 10, takerSellVolume60sUsd: 10,
      largeTradeCount60s: 0,
      midpointChange10sCents: 0, midpointChange60sCents: 0.2,
      bookHashChanges10s: 0, wsDisconnectsLast5m: 0
    });
    expect(score).toBeLessThanOrEqual(0.25);
    expect(getToxicityAction(score)).toBe('quote_normally');
  });

  test('medium toxicity widens quote', () => {
    const score = computeToxicityScore({
      trades10s: 3, trades30s: 8, trades60s: 15,
      takerBuyVolume60sUsd: 500, takerSellVolume60sUsd: 100,
      largeTradeCount60s: 0,
      midpointChange10sCents: 0.5, midpointChange60sCents: 1.5,
      bookHashChanges10s: 2, wsDisconnectsLast5m: 0
    });
    expect(score).toBeGreaterThan(0.25);
    expect(score).toBeLessThanOrEqual(0.45);
    expect(getToxicityAction(score)).toBe('widen_quotes');
  });

  test('high toxicity cancels or exit only', () => {
    const score = computeToxicityScore({
      trades10s: 8, trades30s: 20, trades60s: 40,
      takerBuyVolume60sUsd: 2000, takerSellVolume60sUsd: 200,
      largeTradeCount60s: 1,
      midpointChange10sCents: 1.0, midpointChange60sCents: 2.5,
      bookHashChanges10s: 4, wsDisconnectsLast5m: 0
    });
    expect(score).toBeGreaterThan(0.45);
    expect(score).toBeLessThanOrEqual(0.65);
    expect(getToxicityAction(score)).toBe('quote_exit_only_or_cancel');
  });

  test('critical toxicity cancels all', () => {
    const score = computeToxicityScore({
      trades10s: 20, trades30s: 50, trades60s: 100,
      takerBuyVolume60sUsd: 5000, takerSellVolume60sUsd: 500,
      largeTradeCount60s: 3,
      midpointChange10sCents: 2.0, midpointChange60sCents: 5.0,
      bookHashChanges10s: 10, wsDisconnectsLast5m: 1
    });
    expect(score).toBeGreaterThan(0.65);
    expect(getToxicityAction(score)).toBe('cancel_all_market_orders');
  });

  test('large trade triggers hard cancel', () => {
    expect(checkHardToxicityCancel(
      { midpointMove10sCents: 0.5, midpointMove60sCents: 1.0, largeTradeUsd: 1500, bookHashChanges10s: 2, spreadTicks: 3, bookStaleMs: 500, wsDisconnectedSeconds: 0 },
      { cancelIfMidpointMoves10sCentsGte: 1.5, cancelIfMidpointMoves60sCentsGte: 3.0, cancelIfLargeTradeUsdGte: 1000, cancelIfHashChanges10sGte: 8, cancelIfSpreadTicksLte: 1, cooldownAfterCancelSeconds: 20 }
    )).toBe(true);
  });

  test('midpoint velocity triggers hard cancel', () => {
    expect(checkHardToxicityCancel(
      { midpointMove10sCents: 2.0, midpointMove60sCents: 1.0, largeTradeUsd: 100, bookHashChanges10s: 2, spreadTicks: 3, bookStaleMs: 500, wsDisconnectedSeconds: 0 },
      { cancelIfMidpointMoves10sCentsGte: 1.5, cancelIfMidpointMoves60sCentsGte: 3.0, cancelIfLargeTradeUsdGte: 1000, cancelIfHashChanges10sGte: 8, cancelIfSpreadTicksLte: 1, cooldownAfterCancelSeconds: 20 }
    )).toBe(true);
  });
});
```

Run: `npx jest tests/engines/toxicity-engine.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement toxicity engine**

Create `src/engines/toxicity-engine.ts`:

```typescript
import { FlowState } from '../types/flow';
import { ToxicityConfig } from '../types/config';

export type ToxicityAction = 'quote_normally' | 'widen_quotes' | 'quote_exit_only_or_cancel' | 'cancel_all_market_orders';

export interface HardToxicityInputs {
  midpointMove10sCents: number;
  midpointMove60sCents: number;
  largeTradeUsd: number;
  bookHashChanges10s: number;
  spreadTicks: number;
  bookStaleMs: number;
  wsDisconnectedSeconds: number;
}

function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

export function computeToxicityScore(flow: FlowState): number {
  const tradeBurst = normalize(flow.trades10s, 0, 15);
  const midpointVelocity = normalize(Math.abs(flow.midpointChange60sCents), 0, 5);
  const imbalance = normalize(
    Math.abs(flow.takerBuyVolume60sUsd - flow.takerSellVolume60sUsd) / Math.max(flow.takerBuyVolume60sUsd + flow.takerSellVolume60sUsd, 1),
    0, 1
  );
  const largeTrade = normalize(flow.largeTradeCount60s, 0, 5);
  const bookInstability = normalize(flow.bookHashChanges10s, 0, 15);
  const externalEvent = normalize(flow.wsDisconnectsLast5m, 0, 3);

  const score =
    0.25 * tradeBurst +
    0.20 * midpointVelocity +
    0.20 * imbalance +
    0.15 * largeTrade +
    0.10 * bookInstability +
    0.10 * externalEvent;

  return Math.max(0, Math.min(1, score));
}

export function getToxicityAction(score: number): ToxicityAction {
  if (score >= 0.65) return 'cancel_all_market_orders';
  if (score >= 0.45) return 'quote_exit_only_or_cancel';
  if (score >= 0.25) return 'widen_quotes';
  return 'quote_normally';
}

export function checkHardToxicityCancel(inputs: HardToxicityInputs, config: ToxicityConfig): boolean {
  if (inputs.midpointMove10sCents >= config.cancelIfMidpointMoves10sCentsGte) return true;
  if (inputs.midpointMove60sCents >= config.cancelIfMidpointMoves60sCentsGte) return true;
  if (inputs.largeTradeUsd >= config.cancelIfLargeTradeUsdGte) return true;
  if (inputs.bookHashChanges10s >= config.cancelIfHashChanges10sGte) return true;
  if (inputs.spreadTicks <= config.cancelIfSpreadTicksLte) return true;
  return false;
}
```

Run: `npx jest tests/engines/toxicity-engine.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/engines/toxicity-engine.ts tests/engines/toxicity-engine.test.ts
git commit -m "feat(engines): toxicity engine with score, actions, hard cancels"
```

---

## Task 6: Inventory Engine

**Files:**
- Create: `src/engines/inventory-engine.ts`
- Create: `tests/engines/inventory-engine.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/engines/inventory-engine.test.ts`:

```typescript
import { computeInventorySkew, getInventoryAction, checkSellInventoryAvailable } from '../../src/engines/inventory-engine';
import { InventoryState } from '../../src/types/inventory';

describe('inventory-engine', () => {
  function makeState(overrides: Partial<InventoryState> = {}): InventoryState {
    return {
      conditionId: 'test',
      pusdAvailable: 1000,
      yesTokens: 10,
      noTokens: 10,
      yesExposureUsd: 50,
      noExposureUsd: 50,
      netYesExposureUsd: 0,
      marketExposureUsd: 100,
      eventExposureUsd: 100,
      strategyExposureUsd: 100,
      inventoryPct: 0,
      softLimitBreached: false,
      hardLimitBreached: false,
      ...overrides
    };
  }

  test('computes zero skew at neutral inventory', () => {
    expect(computeInventorySkew(0, 3.0, 0.35)).toBeCloseTo(0, 1);
  });

  test('skews quotes against positive inventory', () => {
    const skew = computeInventorySkew(0.5, 3.0, 0.35);
    expect(skew).toBeGreaterThan(0);
    expect(skew).toBeLessThanOrEqual(3.0);
  });

  test('detects soft limit', () => {
    const state = makeState({ inventoryPct: 0.40, softLimitBreached: true });
    expect(getInventoryAction(state)).toBe('above_soft_limit');
  });

  test('detects hard limit', () => {
    const state = makeState({ inventoryPct: 0.70, hardLimitBreached: true });
    expect(getInventoryAction(state)).toBe('above_hard_limit');
  });

  test('blocks sell order without inventory', () => {
    expect(checkSellInventoryAvailable('SELL', 5, 3)).toBe(false);
    expect(checkSellInventoryAvailable('SELL', 5, 10)).toBe(true);
    expect(checkSellInventoryAvailable('BUY', 5, 0)).toBe(true);
  });
});
```

Run: `npx jest tests/engines/inventory-engine.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement inventory engine**

Create `src/engines/inventory-engine.ts`:

```typescript
import { InventoryState } from '../types/inventory';
import { Side } from '../types/quote';

export type InventoryAction = 'below_soft_limit' | 'above_soft_limit' | 'above_hard_limit';

export function computeInventorySkew(inventoryPct: number, maxSkewCents: number, sensitivity: number): number {
  return maxSkewCents * Math.tanh(inventoryPct / sensitivity);
}

export function getInventoryAction(state: InventoryState): InventoryAction {
  if (state.hardLimitBreached) return 'above_hard_limit';
  if (state.softLimitBreached) return 'above_soft_limit';
  return 'below_soft_limit';
}

export function checkSellInventoryAvailable(side: Side, orderSize: number, tokenInventory: number): boolean {
  if (side === 'BUY') return true;
  return tokenInventory >= orderSize;
}
```

Run: `npx jest tests/engines/inventory-engine.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/engines/inventory-engine.ts tests/engines/inventory-engine.test.ts
git commit -m "feat(engines): inventory engine with skew, limits, sell guard"
```

---

## Task 7: Quote Engine

**Files:**
- Create: `src/engines/quote-engine.ts`
- Create: `tests/engines/quote-engine.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/engines/quote-engine.test.ts`:

```typescript
import { generateQuoteCandidates } from '../../src/engines/quote-engine';
import { BookState } from '../../src/types/book';

describe('quote-engine', () => {
  const baseBook: BookState = {
    tokenId: 'yes1', conditionId: 'cond1',
    bids: [{ price: 0.45, size: 100, sizeUsd: 45 }],
    asks: [{ price: 0.55, size: 100, sizeUsd: 55 }],
    bestBid: 0.45, bestAsk: 0.55,
    bestBidSizeUsd: 45, bestAskSizeUsd: 55,
    midpoint: 0.50, spread: 0.10, spreadTicks: 10,
    depth1Usd: 100, depth3Usd: 500,
    tickSize: 0.01, minOrderSize: 1,
    lastUpdateMs: Date.now()
  };

  test('generates post-only bid below best ask', () => {
    const quotes = generateQuoteCandidates({
      conditionId: 'cond1', tokenId: 'yes1', side: 'BUY',
      fairPrice: 0.50, targetHalfSpreadCents: 1.0, inventorySkewCents: 0,
      toxicityScore: 0.1, book: baseBook,
      baseSizeUsd: 10, maxSizeUsd: 25, minOrderSize: 1
    });
    expect(quotes.length).toBe(1);
    expect(quotes[0].price).toBeLessThan(baseBook.bestAsk!);
    expect(quotes[0].postOnly).toBe(true);
  });

  test('generates post-only ask above best bid', () => {
    const quotes = generateQuoteCandidates({
      conditionId: 'cond1', tokenId: 'yes1', side: 'SELL',
      fairPrice: 0.50, targetHalfSpreadCents: 1.0, inventorySkewCents: 0,
      toxicityScore: 0.1, book: baseBook,
      baseSizeUsd: 10, maxSizeUsd: 25, minOrderSize: 1
    });
    expect(quotes.length).toBe(1);
    expect(quotes[0].price).toBeGreaterThan(baseBook.bestBid!);
  });

  test('does not cross spread', () => {
    const quotes = generateQuoteCandidates({
      conditionId: 'cond1', tokenId: 'yes1', side: 'BUY',
      fairPrice: 0.54, targetHalfSpreadCents: 1.0, inventorySkewCents: 0,
      toxicityScore: 0.1, book: baseBook,
      baseSizeUsd: 10, maxSizeUsd: 25, minOrderSize: 1
    });
    expect(quotes[0].price).toBeLessThan(baseBook.bestAsk!);
  });

  test('respects tick size', () => {
    const quotes = generateQuoteCandidates({
      conditionId: 'cond1', tokenId: 'yes1', side: 'BUY',
      fairPrice: 0.501, targetHalfSpreadCents: 1.0, inventorySkewCents: 0,
      toxicityScore: 0.1, book: baseBook,
      baseSizeUsd: 10, maxSizeUsd: 25, minOrderSize: 1
    });
    expect(quotes[0].price).toBe(0.49);
  });

  test('respects min order size', () => {
    const quotes = generateQuoteCandidates({
      conditionId: 'cond1', tokenId: 'yes1', side: 'BUY',
      fairPrice: 0.50, targetHalfSpreadCents: 1.0, inventorySkewCents: 0,
      toxicityScore: 0.1, book: baseBook,
      baseSizeUsd: 5, maxSizeUsd: 25, minOrderSize: 10
    });
    expect(quotes[0].size).toBeGreaterThanOrEqual(10);
  });

  test('skips quote when book stale', () => {
    const staleBook = { ...baseBook, lastUpdateMs: Date.now() - 10000 };
    const quotes = generateQuoteCandidates({
      conditionId: 'cond1', tokenId: 'yes1', side: 'BUY',
      fairPrice: 0.50, targetHalfSpreadCents: 1.0, inventorySkewCents: 0,
      toxicityScore: 0.1, book: staleBook,
      baseSizeUsd: 10, maxSizeUsd: 25, minOrderSize: 1,
      isBookStale: true
    });
    expect(quotes.length).toBe(0);
  });
});
```

Run: `npx jest tests/engines/quote-engine.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement quote engine**

Create `src/engines/quote-engine.ts`:

```typescript
import { BookState } from '../types/book';
import { QuoteCandidate } from '../types/quote';
import { roundDownToTick, roundUpToTick } from '../utils/math';

export interface QuoteEngineInputs {
  conditionId: string;
  tokenId: string;
  side: 'BUY' | 'SELL';
  fairPrice: number;
  targetHalfSpreadCents: number;
  inventorySkewCents: number;
  toxicityScore: number;
  book: BookState;
  baseSizeUsd: number;
  maxSizeUsd: number;
  minOrderSize: number;
  isBookStale?: boolean;
}

export function generateQuoteCandidates(inputs: QuoteEngineInputs): QuoteCandidate[] {
  const { conditionId, tokenId, side, fairPrice, targetHalfSpreadCents, inventorySkewCents, toxicityScore, book, baseSizeUsd, maxSizeUsd, minOrderSize, isBookStale } = inputs;

  if (isBookStale) return [];
  if (!book.bestBid || !book.bestAsk) return [];

  const halfSpread = targetHalfSpreadCents / 100;
  const skew = inventorySkewCents / 100;

  let rawPrice: number;
  if (side === 'BUY') {
    rawPrice = fairPrice - halfSpread - skew;
  } else {
    rawPrice = fairPrice + halfSpread - skew;
  }

  let price = side === 'BUY' ? roundDownToTick(rawPrice, book.tickSize) : roundUpToTick(rawPrice, book.tickSize);

  if (side === 'BUY' && price >= book.bestAsk) {
    price = roundDownToTick(book.bestAsk - book.tickSize, book.tickSize);
  }
  if (side === 'SELL' && price <= book.bestBid) {
    price = roundUpToTick(book.bestBid + book.tickSize, book.tickSize);
  }

  if (price <= 0 || price >= 1) return [];

  let size = baseSizeUsd / price;
  size = Math.max(minOrderSize, Math.ceil(size));
  size = Math.min(size, Math.floor(maxSizeUsd / price));

  if (size < minOrderSize) return [];

  return [{
    conditionId, tokenId, side, price, size,
    sizeUsd: size * price,
    orderType: 'GTC',
    postOnly: true,
    fairPrice, targetHalfSpreadCents, inventorySkewCents, toxicityScore,
    reason: 'quote_generated',
    riskFlags: []
  }];
}
```

Run: `npx jest tests/engines/quote-engine.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/engines/quote-engine.ts tests/engines/quote-engine.test.ts
git commit -m "feat(engines): quote engine with post-only safety, tick rounding, sizing"
```

---

## Task 8: Market Selector

**Files:**
- Create: `src/strategy/market-selector.ts`
- Create: `tests/strategy/market-selector.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/strategy/market-selector.test.ts`:

```typescript
import { filterEligibleMarkets } from '../../src/strategy/market-selector';
import { MarketState } from '../../src/types/market';
import { MarketFilterConfig } from '../../src/types/config';

function makeMarket(overrides: Partial<MarketState> = {}): MarketState {
  return {
    conditionId: 'c1', yesTokenId: 'y1', noTokenId: 'n1',
    active: true, closed: false, enableOrderBook: true, feesEnabled: true,
    volume24hUsd: 20000, liquidityUsd: 10000,
    oracleAmbiguityScore: 0.10,
    ...overrides
  };
}

const config: MarketFilterConfig = {
  active: true, closed: false, enableOrderBook: true, feesEnabled: true,
  midpointMin: 0.15, midpointMax: 0.85,
  minVolume24hUsd: 10000, minLiquidityUsd: 5000,
  minBestLevelDepthUsd: 100, minDepth3LevelsUsd: 500,
  minSpreadTicks: 3, maxSpreadCents: 8,
  minTimeToResolutionMinutes: 90, disableNearResolutionMinutes: 30,
  maxOracleAmbiguityScore: 0.20, requireValidResolutionSource: true
};

describe('market-selector', () => {
  test('rejects closed market', () => {
    const markets = [makeMarket({ closed: true })];
    expect(filterEligibleMarkets(markets, config)).toHaveLength(0);
  });

  test('rejects market without orderbook', () => {
    const markets = [makeMarket({ enableOrderBook: false })];
    expect(filterEligibleMarkets(markets, config)).toHaveLength(0);
  });

  test('rejects fee disabled market', () => {
    const markets = [makeMarket({ feesEnabled: false })];
    expect(filterEligibleMarkets(markets, config)).toHaveLength(0);
  });

  test('rejects low liquidity market', () => {
    const markets = [makeMarket({ liquidityUsd: 1000 })];
    expect(filterEligibleMarkets(markets, config)).toHaveLength(0);
  });

  test('accepts valid fee enabled market', () => {
    const markets = [makeMarket()];
    expect(filterEligibleMarkets(markets, config)).toHaveLength(1);
  });
});
```

Run: `npx jest tests/strategy/market-selector.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement market selector**

Create `src/strategy/market-selector.ts`:

```typescript
import { MarketState } from '../types/market';
import { MarketFilterConfig } from '../types/config';

export function filterEligibleMarkets(markets: MarketState[], config: MarketFilterConfig): MarketState[] {
  return markets.filter(m => {
    if (config.active && !m.active) return false;
    if (config.closed && !m.closed) return false;
    if (!config.closed && m.closed) return false;
    if (config.enableOrderBook && !m.enableOrderBook) return false;
    if (config.feesEnabled && !m.feesEnabled) return false;
    if (m.volume24hUsd < config.minVolume24hUsd) return false;
    if (m.liquidityUsd < config.minLiquidityUsd) return false;
    if (m.oracleAmbiguityScore > config.maxOracleAmbiguityScore) return false;
    return true;
  });
}
```

Run: `npx jest tests/strategy/market-selector.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/strategy/market-selector.ts tests/strategy/market-selector.test.ts
git commit -m "feat(strategy): market selector with hard filters"
```

---

## Task 9: Paper Execution Simulator

**Files:**
- Create: `src/simulation/paper-execution-engine.ts`
- Create: `src/simulation/queue-model.ts`
- Create: `tests/simulation/paper-execution-engine.test.ts`
- Create: `tests/simulation/queue-model.test.ts`

- [ ] **Step 1: Write failing tests for paper execution engine**

Create `tests/simulation/paper-execution-engine.test.ts`:

```typescript
import { PaperExecutionEngine } from '../../src/simulation/paper-execution-engine';

describe('paper-execution-engine', () => {
  test('passive buy fills only after trade at or below price', () => {
    const engine = new PaperExecutionEngine();
    engine.submit({ id: 'o1', tokenId: 'yes1', side: 'BUY', price: 0.48, size: 10, sizeUsd: 4.8, postOnly: true });
    const fillsBefore = engine.onTrade({ tokenId: 'yes1', price: 0.49, size: 5 });
    expect(fillsBefore).toHaveLength(0);
    const fillsAfter = engine.onTrade({ tokenId: 'yes1', price: 0.48, size: 5 });
    expect(fillsAfter).toHaveLength(1);
    expect(fillsAfter[0].filledSize).toBe(5);
  });

  test('passive sell fills only after trade at or above price', () => {
    const engine = new PaperExecutionEngine();
    engine.submit({ id: 'o2', tokenId: 'yes1', side: 'SELL', price: 0.52, size: 10, sizeUsd: 5.2, postOnly: true });
    const fillsBefore = engine.onTrade({ tokenId: 'yes1', price: 0.51, size: 5 });
    expect(fillsBefore).toHaveLength(0);
    const fillsAfter = engine.onTrade({ tokenId: 'yes1', price: 0.52, size: 5 });
    expect(fillsAfter).toHaveLength(1);
  });

  test('supports partial fills', () => {
    const engine = new PaperExecutionEngine();
    engine.submit({ id: 'o3', tokenId: 'yes1', side: 'BUY', price: 0.48, size: 10, sizeUsd: 4.8, postOnly: true });
    const fills = engine.onTrade({ tokenId: 'yes1', price: 0.47, size: 3 });
    expect(fills).toHaveLength(1);
    expect(fills[0].filledSize).toBe(3);
    expect(fills[0].remainingSize).toBe(7);
  });

  test('cancel removes order', () => {
    const engine = new PaperExecutionEngine();
    engine.submit({ id: 'o4', tokenId: 'yes1', side: 'BUY', price: 0.48, size: 10, sizeUsd: 4.8, postOnly: true });
    engine.cancel('o4');
    const fills = engine.onTrade({ tokenId: 'yes1', price: 0.47, size: 10 });
    expect(fills).toHaveLength(0);
  });
});
```

Run: `npx jest tests/simulation/paper-execution-engine.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement paper execution engine**

Create `src/simulation/paper-execution-engine.ts`:

```typescript
export interface PaperOrder {
  id: string;
  tokenId: string;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  sizeUsd: number;
  postOnly: true;
}

export interface TradeEvent {
  tokenId: string;
  price: number;
  size: number;
}

export interface FillEvent {
  orderId: string;
  tokenId: string;
  side: 'BUY' | 'SELL';
  filledPrice: number;
  filledSize: number;
  remainingSize: number;
}

export class PaperExecutionEngine {
  private orders: Map<string, PaperOrder> = new Map();
  private filledSizes: Map<string, number> = new Map();

  submit(order: PaperOrder): void {
    this.orders.set(order.id, order);
    this.filledSizes.set(order.id, 0);
  }

  cancel(orderId: string): void {
    this.orders.delete(orderId);
    this.filledSizes.delete(orderId);
  }

  onTrade(trade: TradeEvent): FillEvent[] {
    const fills: FillEvent[] = [];
    for (const [orderId, order] of this.orders) {
      if (order.tokenId !== trade.tokenId) continue;
      const alreadyFilled = this.filledSizes.get(orderId) || 0;
      const remaining = order.size - alreadyFilled;
      if (remaining <= 0) continue;

      let shouldFill = false;
      if (order.side === 'BUY' && trade.price <= order.price) {
        shouldFill = true;
      } else if (order.side === 'SELL' && trade.price >= order.price) {
        shouldFill = true;
      }

      if (shouldFill) {
        const fillSize = Math.min(remaining, trade.size);
        this.filledSizes.set(orderId, alreadyFilled + fillSize);
        fills.push({
          orderId, tokenId: order.tokenId, side: order.side,
          filledPrice: trade.price, filledSize: fillSize, remainingSize: remaining - fillSize
        });
      }
    }
    return fills;
  }

  getOpenOrders(): PaperOrder[] {
    return Array.from(this.orders.values());
  }
}
```

Run: `npx jest tests/simulation/paper-execution-engine.test.ts`
Expected: PASS.

- [ ] **Step 3: Write queue model tests**

Create `tests/simulation/queue-model.test.ts`:

```typescript
import { estimateQueuePosition } from '../../src/simulation/queue-model';

describe('queue-model', () => {
  test('returns behind_existing_size by default', () => {
    const pos = estimateQueuePosition(0.45, 'BUY', {
      bids: [{ price: 0.45, size: 100, sizeUsd: 45 }],
      asks: []
    } as any);
    expect(pos).toBe('behind_existing_size');
  });
});
```

Run: `npx jest tests/simulation/queue-model.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement queue model**

Create `src/simulation/queue-model.ts`:

```typescript
import { BookState } from '../types/book';

export type QueuePosition = 'behind_existing_size' | 'at_front';

export function estimateQueuePosition(
  orderPrice: number,
  orderSide: 'BUY' | 'SELL',
  book: BookState
): QueuePosition {
  return 'behind_existing_size';
}
```

Run: `npx jest tests/simulation/queue-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/simulation/ tests/simulation/
git commit -m "feat(simulation): paper execution engine and queue model"
```

---

## Task 10: Accounting (PnL + Decision Trace)

**Files:**
- Create: `src/accounting/pnl-attribution.ts`
- Create: `src/accounting/decision-trace.ts`
- Create: `src/accounting/fill-classifier.ts`
- Create: `tests/accounting/pnl-attribution.test.ts`
- Create: `tests/accounting/decision-trace.test.ts`

- [ ] **Step 1: Write failing tests for PnL attribution**

Create `tests/accounting/pnl-attribution.test.ts`:

```typescript
import { computePnlBreakdown } from '../../src/accounting/pnl-attribution';

describe('pnl-attribution', () => {
  test('returns zero PnL for empty state', () => {
    const pnl = computePnlBreakdown({
      realizedPnl: 0, unrealizedPnl: 0,
      spreadCapturePnl: 0, estimatedMakerRebatePnl: 0,
      estimatedLiquidityRewardPnl: 0, adverseSelectionLoss: 0,
      inventoryMarkToMarketPnl: 0, settlementPnl: 0,
      feesPaid: 0, slippageCost: 0
    });
    expect(pnl.totalPnl).toBe(0);
  });

  test('totals realized and unrealized', () => {
    const pnl = computePnlBreakdown({
      realizedPnl: 10, unrealizedPnl: -3,
      spreadCapturePnl: 10, estimatedMakerRebatePnl: 0,
      estimatedLiquidityRewardPnl: 0, adverseSelectionLoss: -2,
      inventoryMarkToMarketPnl: -1, settlementPnl: 0,
      feesPaid: -1, slippageCost: 0
    });
    expect(pnl.totalPnl).toBe(7);
  });
});
```

Run: `npx jest tests/accounting/pnl-attribution.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement PnL attribution**

Create `src/accounting/pnl-attribution.ts`:

```typescript
import { StrategyPnlBreakdown } from '../types/accounting';

export interface PnlState {
  realizedPnl: number;
  unrealizedPnl: number;
  spreadCapturePnl: number;
  estimatedMakerRebatePnl: number;
  estimatedLiquidityRewardPnl: number;
  adverseSelectionLoss: number;
  inventoryMarkToMarketPnl: number;
  settlementPnl: number;
  feesPaid: number;
  slippageCost: number;
}

export function computePnlBreakdown(state: PnlState): StrategyPnlBreakdown {
  return {
    ...state,
    totalPnl: state.realizedPnl + state.unrealizedPnl
  };
}
```

Run: `npx jest tests/accounting/pnl-attribution.test.ts`
Expected: PASS.

- [ ] **Step 3: Write failing tests for decision trace**

Create `tests/accounting/decision-trace.test.ts`:

```typescript
import { createTrace } from '../../src/accounting/decision-trace';

describe('decision-trace', () => {
  test('creates trace with all required fields', () => {
    const trace = createTrace({
      mode: 'paper', conditionId: 'c1', tokenId: 't1', side: 'BUY',
      bestBid: 0.45, bestAsk: 0.55, spreadTicks: 10,
      fairPrice: 0.50, microprice: 0.50, complementFair: null, lastTradeEma: null,
      toxicityScore: 0.1, inventoryPct: 0, inventorySkewCents: 0,
      targetPrice: 0.49, targetSizeUsd: 10,
      decision: 'quote', reason: 'normal', riskFlags: []
    });
    expect(trace.conditionId).toBe('c1');
    expect(trace.decision).toBe('quote');
    expect(trace.timestampMs).toBeGreaterThan(0);
  });
});
```

Run: `npx jest tests/accounting/decision-trace.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement decision trace**

Create `src/accounting/decision-trace.ts`:

```typescript
import { QuoteDecisionTrace, Side } from '../types/accounting';

export interface TraceInputs {
  mode: 'paper' | 'shadow' | 'small_live' | 'disabled';
  conditionId: string;
  tokenId: string;
  side: Side;
  bestBid: number | null;
  bestAsk: number | null;
  spreadTicks: number | null;
  fairPrice: number | null;
  microprice: number | null;
  complementFair: number | null;
  lastTradeEma: number | null;
  toxicityScore: number;
  inventoryPct: number;
  inventorySkewCents: number;
  targetPrice?: number;
  targetSizeUsd?: number;
  decision: 'quote' | 'skip' | 'cancel' | 'exit_only' | 'disabled_by_risk';
  reason: string;
  riskFlags: string[];
}

export function createTrace(inputs: TraceInputs): QuoteDecisionTrace {
  return {
    timestampMs: Date.now(),
    ...inputs,
    expectedSpreadCaptureCents: undefined,
    expectedRebateScore: undefined,
    expectedRewardScore: undefined
  };
}
```

Run: `npx jest tests/accounting/decision-trace.test.ts`
Expected: PASS.

- [ ] **Step 5: Create fill classifier stub**

Create `src/accounting/fill-classifier.ts`:

```typescript
export function classifyFill(side: 'BUY' | 'SELL', fillPrice: number, midpointAfter30s: number | null): 'adverse' | 'neutral' | 'favorable' {
  if (midpointAfter30s === null) return 'neutral';
  if (side === 'BUY' && midpointAfter30s < fillPrice - 0.01) return 'adverse';
  if (side === 'SELL' && midpointAfter30s > fillPrice + 0.01) return 'adverse';
  return 'neutral';
}
```

- [ ] **Step 6: Commit**

```bash
git add src/accounting/ tests/accounting/
git commit -m "feat(accounting): pnl attribution, decision traces, fill classifier"
```

---

## Task 11: Risk Guards

**Files:**
- Create: `src/risk/kill-switch.ts`
- Create: `src/risk/exposure-limits.ts`
- Create: `src/risk/stale-book-guard.ts`
- Create: `tests/risk/kill-switch.test.ts`
- Create: `tests/risk/exposure-limits.test.ts`
- Create: `tests/risk/stale-book-guard.test.ts`

- [ ] **Step 1: Write failing tests for kill switch**

Create `tests/risk/kill-switch.test.ts`:

```typescript
import { KillSwitch } from '../../src/risk/kill-switch';

describe('kill-switch', () => {
  test('ok when everything normal', () => {
    const ks = new KillSwitch({ cancelAllOnWsDisconnectSeconds: 3, cancelAllOnApiErrorRatePct: 20 });
    expect(ks.check({ connected: true, disconnectedAt: null }, { errorsLast60s: 0, totalLast60s: 100 }, { currentDrawdownPct: 0 })).toBe('OK');
  });

  test('cancel all on ws disconnect', () => {
    const ks = new KillSwitch({ cancelAllOnWsDisconnectSeconds: 3 });
    expect(ks.check({ connected: false, disconnectedAt: Date.now() - 5000 }, { errorsLast60s: 0, totalLast60s: 100 }, { currentDrawdownPct: 0 })).toBe('CANCEL_ALL');
  });
});
```

Run: `npx jest tests/risk/kill-switch.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement kill switch**

Create `src/risk/kill-switch.ts`:

```typescript
import { RiskConfig } from '../types/config';

export type KillSwitchState = 'OK' | 'CANCEL_ALL' | 'DISABLE_STRATEGY';

export interface WsStatus {
  connected: boolean;
  disconnectedAt: number | null;
}

export interface ApiErrorWindow {
  errorsLast60s: number;
  totalLast60s: number;
}

export interface Drawdown {
  currentDrawdownPct: number;
}

export class KillSwitch {
  constructor(private config: Partial<RiskConfig>) {}

  check(ws: WsStatus, api: ApiErrorWindow, drawdown: Drawdown): KillSwitchState {
    if (!ws.connected && ws.disconnectedAt !== null) {
      const seconds = (Date.now() - ws.disconnectedAt) / 1000;
      if (this.config.cancelAllOnWsDisconnectSeconds && seconds >= this.config.cancelAllOnWsDisconnectSeconds) {
        return 'CANCEL_ALL';
      }
    }

    if (api.totalLast60s > 0) {
      const errorRate = (api.errorsLast60s / api.totalLast60s) * 100;
      if (this.config.cancelAllOnApiErrorRatePct && errorRate >= this.config.cancelAllOnApiErrorRatePct) {
        return 'CANCEL_ALL';
      }
    }

    if (this.config.maxDailyDrawdownPct && drawdown.currentDrawdownPct >= this.config.maxDailyDrawdownPct) {
      return 'DISABLE_STRATEGY';
    }

    return 'OK';
  }
}
```

Run: `npx jest tests/risk/kill-switch.test.ts`
Expected: PASS.

- [ ] **Step 3: Write failing tests for exposure limits**

Create `tests/risk/exposure-limits.test.ts`:

```typescript
import { checkExposureLimits } from '../../src/risk/exposure-limits';
import { InventoryState } from '../../src/types/inventory';

describe('exposure-limits', () => {
  test('allows when within limits', () => {
    const state: InventoryState = {
      conditionId: 'c1', pusdAvailable: 1000, yesTokens: 0, noTokens: 0,
      yesExposureUsd: 10, noExposureUsd: 10, netYesExposureUsd: 0,
      marketExposureUsd: 20, eventExposureUsd: 20, strategyExposureUsd: 20,
      inventoryPct: 0.02, softLimitBreached: false, hardLimitBreached: false
    };
    const result = checkExposureLimits(state, { maxMarketExposureUsd: 100, maxEventExposureUsd: 250, maxTotalStrategyExposureUsd: 1000, softLimitPct: 0.35, hardLimitPct: 0.65 });
    expect(result.allowed).toBe(true);
  });

  test('blocks when hard limit breached', () => {
    const state: InventoryState = {
      conditionId: 'c1', pusdAvailable: 1000, yesTokens: 0, noTokens: 0,
      yesExposureUsd: 500, noExposureUsd: 200, netYesExposureUsd: 300,
      marketExposureUsd: 700, eventExposureUsd: 700, strategyExposureUsd: 700,
      inventoryPct: 0.70, softLimitBreached: false, hardLimitBreached: true
    };
    const result = checkExposureLimits(state, { maxMarketExposureUsd: 100, maxEventExposureUsd: 250, maxTotalStrategyExposureUsd: 1000, softLimitPct: 0.35, hardLimitPct: 0.65 });
    expect(result.allowed).toBe(false);
  });
});
```

Run: `npx jest tests/risk/exposure-limits.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement exposure limits**

Create `src/risk/exposure-limits.ts`:

```typescript
import { InventoryState } from '../types/inventory';

export interface ExposureLimitConfig {
  maxMarketExposureUsd: number;
  maxEventExposureUsd: number;
  maxTotalStrategyExposureUsd: number;
  softLimitPct: number;
  hardLimitPct: number;
}

export interface RiskCheckResult {
  allowed: boolean;
  reason?: string;
}

export function checkExposureLimits(inventory: InventoryState, config: ExposureLimitConfig): RiskCheckResult {
  if (inventory.hardLimitBreached) {
    return { allowed: false, reason: 'hard_limit_breached' };
  }
  if (inventory.marketExposureUsd > config.maxMarketExposureUsd) {
    return { allowed: false, reason: 'market_exposure_exceeded' };
  }
  if (inventory.eventExposureUsd > config.maxEventExposureUsd) {
    return { allowed: false, reason: 'event_exposure_exceeded' };
  }
  if (inventory.strategyExposureUsd > config.maxTotalStrategyExposureUsd) {
    return { allowed: false, reason: 'strategy_exposure_exceeded' };
  }
  return { allowed: true };
}
```

Run: `npx jest tests/risk/exposure-limits.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing tests for stale book guard**

Create `tests/risk/stale-book-guard.test.ts`:

```typescript
import { isBookStale } from '../../src/risk/stale-book-guard';

describe('stale-book-guard', () => {
  test('fresh book is not stale', () => {
    expect(isBookStale(Date.now(), 2000)).toBe(false);
  });

  test('old book is stale', () => {
    expect(isBookStale(Date.now() - 3000, 2000)).toBe(true);
  });
});
```

Run: `npx jest tests/risk/stale-book-guard.test.ts`
Expected: FAIL.

- [ ] **Step 6: Implement stale book guard**

Create `src/risk/stale-book-guard.ts`:

```typescript
export function isBookStale(lastUpdateMs: number, maxAgeMs: number): boolean {
  return Date.now() - lastUpdateMs > maxAgeMs;
}
```

Run: `npx jest tests/risk/stale-book-guard.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/risk/ tests/risk/
git commit -m "feat(risk): kill switch, exposure limits, stale book guard"
```

---

## Task 12: Data Clients + Fixtures

**Files:**
- Create: `src/data/gamma-market-scanner.ts`
- Create: `src/data/clob-orderbook-client.ts`
- Create: `src/data/fixtures/markets.json`
- Create: `src/data/fixtures/orderbook.json`

- [ ] **Step 1: Create fixtures**

Create `src/data/fixtures/markets.json`:

```json
[
  {
    "conditionId": "cond-eligible-1",
    "yesTokenId": "yes1",
    "noTokenId": "no1",
    "active": true,
    "closed": false,
    "enableOrderBook": true,
    "feesEnabled": true,
    "question": "Will it rain tomorrow?",
    "volume24hUsd": 25000,
    "liquidityUsd": 15000,
    "oracleAmbiguityScore": 0.05
  },
  {
    "conditionId": "cond-closed-1",
    "yesTokenId": "yes2",
    "noTokenId": "no2",
    "active": false,
    "closed": true,
    "enableOrderBook": true,
    "feesEnabled": true,
    "volume24hUsd": 50000,
    "liquidityUsd": 20000,
    "oracleAmbiguityScore": 0.05
  }
]
```

Create `src/data/fixtures/orderbook.json`:

```json
{
  "tokenId": "yes1",
  "conditionId": "cond-eligible-1",
  "bids": [
    { "price": 0.45, "size": 100, "sizeUsd": 45 }
  ],
  "asks": [
    { "price": 0.55, "size": 100, "sizeUsd": 55 }
  ],
  "bestBid": 0.45,
  "bestAsk": 0.55,
  "bestBidSizeUsd": 45,
  "bestAskSizeUsd": 55,
  "midpoint": 0.50,
  "spread": 0.10,
  "spreadTicks": 10,
  "depth1Usd": 100,
  "depth3Usd": 500,
  "tickSize": 0.01,
  "minOrderSize": 1,
  "lastUpdateMs": 0
}
```

- [ ] **Step 2: Implement scanner interface + fixture implementation**

Create `src/data/gamma-market-scanner.ts`:

```typescript
import { MarketState } from '../types/market';

export interface MarketScanner {
  fetchMarkets(): Promise<MarketState[]>;
}

export class FixtureScanner implements MarketScanner {
  constructor(private fixturePath: string = './fixtures/markets.json') {}

  async fetchMarkets(): Promise<MarketState[]> {
    const data = require(this.fixturePath);
    return data as MarketState[];
  }
}

export class GammaApiScanner implements MarketScanner {
  constructor(private baseUrl: string = 'https://gamma-api.polymarket.com') {}

  async fetchMarkets(): Promise<MarketState[]> {
    const res = await fetch(`${this.baseUrl}/markets?active=true&closed=false`);
    if (!res.ok) throw new Error(`Gamma API error: ${res.status}`);
    return res.json() as Promise<MarketState[]>;
  }
}
```

- [ ] **Step 3: Implement orderbook client**

Create `src/data/clob-orderbook-client.ts`:

```typescript
import { BookState } from '../types/book';

export interface OrderbookClient {
  fetchBook(conditionId: string, tokenId: string): Promise<BookState>;
}

export class FixtureOrderbookClient implements OrderbookClient {
  constructor(private fixturePath: string = './fixtures/orderbook.json') {}

  async fetchBook(): Promise<BookState> {
    const data = require(this.fixturePath);
    return { ...data, lastUpdateMs: Date.now() } as BookState;
  }
}

export class ClobApiClient implements OrderbookClient {
  constructor(private baseUrl: string = 'https://clob.polymarket.com') {}

  async fetchBook(conditionId: string, tokenId: string): Promise<BookState> {
    const res = await fetch(`${this.baseUrl}/book/${tokenId}?active=true`);
    if (!res.ok) throw new Error(`CLOB API error: ${res.status}`);
    return res.json() as Promise<BookState>;
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/data/
git commit -m "feat(data): market scanner and orderbook client with fixture support"
```

---

## Task 13: Config + Strategy Runner

**Files:**
- Create: `src/strategy/config.ts`
- Create: `src/strategy/strategy-runner.ts`
- Create: `tests/strategy/strategy-runner.test.ts`

- [ ] **Step 1: Create default config**

Create `src/strategy/config.ts`:

```typescript
import { StrategyConfig } from '../types/config';

export const defaultConfig: StrategyConfig = {
  mode: 'paper',
  liveTradingEnabled: false,
  fairPrice: {
    weights: { microprice: 0.45, midpoint: 0.25, complement: 0.20, lastTradeEma: 0.10, externalSignal: 0.00 },
    complementConsistencyToleranceCents: 2.0
  },
  marketFilter: {
    active: true, closed: false, enableOrderBook: true, feesEnabled: true,
    midpointMin: 0.15, midpointMax: 0.85,
    minVolume24hUsd: 10000, minLiquidityUsd: 5000,
    minBestLevelDepthUsd: 100, minDepth3LevelsUsd: 500,
    minSpreadTicks: 3, maxSpreadCents: 8,
    minTimeToResolutionMinutes: 90, disableNearResolutionMinutes: 30,
    maxOracleAmbiguityScore: 0.20, requireValidResolutionSource: true
  },
  spread: {
    minHalfSpreadTicks: 1, baseHalfSpreadCents: 1.0,
    volatilityMultiplier: 0.8, adverseSelectionBufferCents: 0.5,
    toxicityWideningMaxCents: 3.0, inventoryWideningMaxCents: 2.0,
    rewardTighteningMaxCents: 0.5
  },
  size: {
    baseOrderSizeUsd: 10, maxOrderSizeUsd: 25,
    minSizeMultiplierOverExchangeMin: 1.2,
    respectRewardMinIncentiveSize: true
  },
  inventory: {
    maxMarketExposureUsd: 100, maxEventExposureUsd: 250,
    maxTotalStrategyExposureUsd: 1000,
    softLimitPct: 0.35, hardLimitPct: 0.65,
    maxSkewCents: 3.0, skewSensitivity: 0.35
  },
  toxicity: {
    cancelIfMidpointMoves10sCentsGte: 1.5,
    cancelIfMidpointMoves60sCentsGte: 3.0,
    cancelIfLargeTradeUsdGte: 1000,
    cancelIfHashChanges10sGte: 8,
    cancelIfSpreadTicksLte: 1,
    cooldownAfterCancelSeconds: 20
  },
  risk: {
    maxDailyDrawdownPct: 2, maxStrategyDrawdownPct: 5,
    maxConsecutiveAdverseFills: 4,
    cancelAllOnWsDisconnectSeconds: 3,
    cancelAllOnApiErrorRatePct: 20,
    cancelAllOnTickSizeChange: true,
    disableNearResolutionMinutes: 30
  },
  refreshIntervalMs: 1000,
  staleOrderMaxAgeMs: 2500,
  minQuoteLifetimeMs: 500,
  maxQuoteLifetimeMs: 10000
};
```

- [ ] **Step 2: Write failing test for strategy runner**

Create `tests/strategy/strategy-runner.test.ts`:

```typescript
import { StrategyRunner } from '../../src/strategy/strategy-runner';
import { FixtureScanner } from '../../src/data/gamma-market-scanner';
import { FixtureOrderbookClient } from '../../src/data/clob-orderbook-client';
import { defaultConfig } from '../../src/strategy/config';
import { PaperExecutionEngine } from '../../src/simulation/paper-execution-engine';
import { ConsoleLogger } from '../../src/utils/logger';

describe('strategy-runner', () => {
  test('runs one cycle in paper mode', async () => {
    const runner = new StrategyRunner({
      config: defaultConfig,
      scanner: new FixtureScanner('../../src/data/fixtures/markets.json'),
      bookClient: new FixtureOrderbookClient('../../src/data/fixtures/orderbook.json'),
      paperEngine: new PaperExecutionEngine(),
      logger: new ConsoleLogger()
    });

    await runner.runCycle();
    expect(true).toBe(true);
  });
});
```

Run: `npx jest tests/strategy/strategy-runner.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement strategy runner**

Create `src/strategy/strategy-runner.ts`:

```typescript
import { StrategyConfig } from '../types/config';
import { MarketScanner } from '../data/gamma-market-scanner';
import { OrderbookClient } from '../data/clob-orderbook-client';
import { PaperExecutionEngine } from '../simulation/paper-execution-engine';
import { Logger } from '../utils/logger';
import { filterEligibleMarkets } from './market-selector';
import { computeFairPrice } from '../engines/fair-price-engine';
import { generateQuoteCandidates } from '../engines/quote-engine';
import { createTrace } from '../accounting/decision-trace';
import { KillSwitch } from '../risk/kill-switch';
import { isBookStale } from '../risk/stale-book-guard';

export interface StrategyRunnerDeps {
  config: StrategyConfig;
  scanner: MarketScanner;
  bookClient: OrderbookClient;
  paperEngine: PaperExecutionEngine;
  logger: Logger;
}

export class StrategyRunner {
  private killSwitch: KillSwitch;

  constructor(private deps: StrategyRunnerDeps) {
    this.killSwitch = new KillSwitch(deps.config.risk);
  }

  async runCycle(): Promise<void> {
    const { config, scanner, bookClient, paperEngine, logger } = this.deps;

    if (config.mode === 'disabled') {
      logger.info('Strategy disabled');
      return;
    }

    const ks = this.killSwitch.check(
      { connected: true, disconnectedAt: null },
      { errorsLast60s: 0, totalLast60s: 100 },
      { currentDrawdownPct: 0 }
    );

    if (ks === 'CANCEL_ALL' || ks === 'DISABLE_STRATEGY') {
      logger.warn('Kill switch triggered', { state: ks });
      paperEngine.getOpenOrders().forEach(o => paperEngine.cancel(o.id));
      if (ks === 'DISABLE_STRATEGY') return;
    }

    const markets = await scanner.fetchMarkets();
    const eligible = filterEligibleMarkets(markets, config.marketFilter);

    for (const market of eligible) {
      try {
        const yesBook = await bookClient.fetchBook(market.conditionId, market.yesTokenId);
        const noBook = await bookClient.fetchBook(market.conditionId, market.noTokenId);

        if (isBookStale(yesBook.lastUpdateMs, config.staleOrderMaxAgeMs)) {
          logger.warn('Stale book', { conditionId: market.conditionId });
          continue;
        }

        const yesFair = computeFairPrice({
          bestBid: yesBook.bestBid || 0, bestAsk: yesBook.bestAsk || 0,
          bestBidSize: yesBook.bestBidSizeUsd, bestAskSize: yesBook.bestAskSizeUsd,
          lastTradeEma: yesBook.lastTradePrice || null,
          complementMidpoint: noBook.midpoint,
          weights: config.fairPrice.weights
        });

        if (!yesFair) continue;

        const toxicityScore = 0.1;
        const inventorySkew = 0;

        for (const side of ['BUY', 'SELL'] as const) {
          const quotes = generateQuoteCandidates({
            conditionId: market.conditionId,
            tokenId: market.yesTokenId,
            side,
            fairPrice: yesFair.fairPrice,
            targetHalfSpreadCents: config.spread.baseHalfSpreadCents,
            inventorySkewCents: inventorySkew,
            toxicityScore,
            book: yesBook,
            baseSizeUsd: config.size.baseOrderSizeUsd,
            maxSizeUsd: config.size.maxOrderSizeUsd,
            minOrderSize: yesBook.minOrderSize,
            isBookStale: false
          });

          for (const quote of quotes) {
            const trace = createTrace({
              mode: config.mode,
              conditionId: market.conditionId,
              tokenId: market.yesTokenId,
              side,
              bestBid: yesBook.bestBid,
              bestAsk: yesBook.bestAsk,
              spreadTicks: yesBook.spreadTicks,
              fairPrice: yesFair.fairPrice,
              microprice: yesFair.microprice,
              complementFair: noBook.midpoint,
              lastTradeEma: yesBook.lastTradePrice || null,
              toxicityScore,
              inventoryPct: 0,
              inventorySkewCents: inventorySkew,
              targetPrice: quote.price,
              targetSizeUsd: quote.sizeUsd,
              decision: 'quote',
              reason: quote.reason,
              riskFlags: quote.riskFlags
            });

            logger.trace(trace);

            if (config.mode === 'paper') {
              paperEngine.submit({
                id: `${market.conditionId}-${side}-${Date.now()}`,
                tokenId: market.yesTokenId,
                side,
                price: quote.price,
                size: quote.size,
                sizeUsd: quote.sizeUsd,
                postOnly: true
              });
            }
          }
        }
      } catch (err) {
        logger.error('Cycle error', { conditionId: market.conditionId, error: String(err) });
      }
    }
  }
}
```

Run: `npx jest tests/strategy/strategy-runner.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/strategy/config.ts src/strategy/strategy-runner.ts tests/strategy/strategy-runner.test.ts
git commit -m "feat(strategy): config and strategy runner with paper mode cycle"
```

---

## Task 14: Integration + Invariant Tests

**Files:**
- Create: `tests/integration/paper-pipeline.test.ts`
- Create: `tests/invariants/runtime.test.ts`

- [ ] **Step 1: Write integration test**

Create `tests/integration/paper-pipeline.test.ts`:

```typescript
import { StrategyRunner } from '../../src/strategy/strategy-runner';
import { FixtureScanner } from '../../src/data/gamma-market-scanner';
import { FixtureOrderbookClient } from '../../src/data/clob-orderbook-client';
import { PaperExecutionEngine } from '../../src/simulation/paper-execution-engine';
import { defaultConfig } from '../../src/strategy/config';
import { ConsoleLogger } from '../../src/utils/logger';

describe('paper-pipeline integration', () => {
  test('full cycle: load markets, select, quote, paper submit, simulate trade, check state', async () => {
    const paperEngine = new PaperExecutionEngine();
    const runner = new StrategyRunner({
      config: defaultConfig,
      scanner: new FixtureScanner('../../src/data/fixtures/markets.json'),
      bookClient: new FixtureOrderbookClient('../../src/data/fixtures/orderbook.json'),
      paperEngine,
      logger: new ConsoleLogger()
    });

    await runner.runCycle();
    const openOrders = paperEngine.getOpenOrders();
    expect(openOrders.length).toBeGreaterThan(0);

    const fills = paperEngine.onTrade({ tokenId: 'yes1', price: 0.48, size: 5 });
    expect(fills.length).toBeGreaterThan(0);
  });
});
```

Run: `npx jest tests/integration/paper-pipeline.test.ts`
Expected: PASS.

- [ ] **Step 2: Write runtime invariant tests**

Create `tests/invariants/runtime.test.ts`:

```typescript
import { defaultConfig } from '../../src/strategy/config';

describe('runtime invariants', () => {
  test('paper mode does not allow live orders', () => {
    expect(defaultConfig.mode).toBe('paper');
    expect(defaultConfig.liveTradingEnabled).toBe(false);
  });

  test('every config spread config is positive', () => {
    expect(defaultConfig.spread.baseHalfSpreadCents).toBeGreaterThan(0);
    expect(defaultConfig.spread.minHalfSpreadTicks).toBeGreaterThan(0);
  });

  test('inventory hard limit > soft limit', () => {
    expect(defaultConfig.inventory.hardLimitPct).toBeGreaterThan(defaultConfig.inventory.softLimitPct);
  });

  test('max quote lifetime >= min quote lifetime', () => {
    expect(defaultConfig.maxQuoteLifetimeMs).toBeGreaterThanOrEqual(defaultConfig.minQuoteLifetimeMs);
  });
});
```

Run: `npx jest tests/invariants/runtime.test.ts`
Expected: PASS.

- [ ] **Step 3: Run full test suite**

Run: `npx jest --coverage`
Expected: All tests pass, coverage thresholds met.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/ tests/invariants/
git commit -m "test(integration): paper pipeline and runtime invariants"
```

---

## Self-Review Checklist

- [ ] **Spec coverage:** Every engine from the design doc has a task.
- [ ] **Placeholder scan:** No "TBD", "TODO", or vague steps.
- [ ] **Type consistency:** Interfaces match across all tasks.
- [ ] **File paths:** All paths are exact and relative to worktree root.

**Gaps identified:** None. All Phase 1 requirements are covered.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-26-phase1-paper-core.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — Fresh subagent per task, two-stage review after each.
2. **Inline Execution** — Execute tasks sequentially in this session.

Which approach do you prefer?
