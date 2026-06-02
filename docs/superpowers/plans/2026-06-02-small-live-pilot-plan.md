# Small Live Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fail-closed `$2` small-live execution path without changing the existing 15-minute Gabagool market-selection or trade-signal business logic.

**Architecture:** Keep pure business logic untouched: `FifteenMinMarketScanner`, `decideAccumulatorEntry`, and `decideEqualizer` remain the sources of truth. Add a live-mode configuration gate, a CLOB order adapter behind the existing `OrderManager` interface, and a fill-tracking adapter that updates `PositionTracker` only from observed fills. `paper` remains default.

**Tech Stack:** TypeScript, Jest, `@polymarket/clob-client-v2`, existing JSONL logger, existing Docker deployment.

---

## Business Logic Non-Regression Rule

Do not modify these files unless a task explicitly says so:
- `src/engines/accumulator.ts`
- `src/engines/equalizer.ts`
- `src/data/fifteen-min-scanner.ts`

The plan includes a dedicated non-regression test task. If any existing accumulator/equalizer/scanner test changes expected values, stop and ask for review.

## File Map

- Create `src/config/live-mode.ts`: parse `TRADING_MODE`, `ENABLE_LIVE_TRADING`, and small-live limits. Fail closed.
- Create `tests/config/live-mode.test.ts`: prove default is paper and small-live requires explicit gates.
- Create `src/execution/live-fill-tracker.ts`: convert observed fills to `PositionTracker.updateFill()` calls.
- Create `tests/execution/live-fill-tracker.test.ts`: prove placement does not update positions, fills do.
- Create `src/execution/polymarket-live-order-client.ts`: minimal adapter implementing `ClobOrderClient` for live CLOB orders/cancels/open orders.
- Create `tests/execution/polymarket-live-order-client.test.ts`: mocked client tests only; no network.
- Modify `src/run-accumulator.ts`: select paper vs small-live dependencies/config. Paper behavior stays default.
- Modify `tests/strategy/accumulator-runner.test.ts`: add guard that live-style order manager does not update tracker unless fill tracker is invoked.
- Keep existing business-logic tests unchanged except adding non-regression coverage if needed.

---

## Task 1: Live Mode Config Gate

**Files:**
- Create: `src/config/live-mode.ts`
- Create: `tests/config/live-mode.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/config/live-mode.test.ts`:

```ts
import { loadLiveModeConfig } from '../../src/config/live-mode';

describe('loadLiveModeConfig', () => {
  it('defaults to paper mode and disables live trading', () => {
    const cfg = loadLiveModeConfig({});

    expect(cfg.mode).toBe('paper');
    expect(cfg.liveEnabled).toBe(false);
    expect(cfg.canPlaceLiveOrders).toBe(false);
  });

  it('fails closed when small_live is set without explicit live enable flag', () => {
    const cfg = loadLiveModeConfig({ TRADING_MODE: 'small_live' });

    expect(cfg.mode).toBe('small_live');
    expect(cfg.liveEnabled).toBe(false);
    expect(cfg.canPlaceLiveOrders).toBe(false);
  });

  it('enables live orders only when both gates are set', () => {
    const cfg = loadLiveModeConfig({ TRADING_MODE: 'small_live', ENABLE_LIVE_TRADING: 'true' });

    expect(cfg.canPlaceLiveOrders).toBe(true);
  });

  it('uses strict $2 pilot limits in small live mode', () => {
    const cfg = loadLiveModeConfig({ TRADING_MODE: 'small_live', ENABLE_LIVE_TRADING: 'true' });

    expect(cfg.risk.maxExposureUsd).toBe(2);
    expect(cfg.risk.maxExposurePerMarketUsd).toBe(2);
    expect(cfg.risk.maxOpenOrders).toBe(1);
    expect(cfg.accumulator.tradeSize).toBe(1);
    expect(cfg.equalizer.tradeSize).toBe(1);
  });
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- tests/config/live-mode.test.ts --runInBand
```

Expected: FAIL because `src/config/live-mode.ts` does not exist.

- [ ] **Step 3: Implement minimal config**

Create `src/config/live-mode.ts`:

```ts
import { AccumulatorConfig } from '../engines/accumulator';
import { EqualizerConfig } from '../engines/equalizer';
import { RiskConfig } from '../risk/pair-cost-risk';

export type TradingMode = 'paper' | 'small_live';

export interface LiveModeConfig {
  mode: TradingMode;
  liveEnabled: boolean;
  canPlaceLiveOrders: boolean;
  accumulator: AccumulatorConfig;
  equalizer: EqualizerConfig;
  risk: RiskConfig;
}

const PAPER_ACCUMULATOR: AccumulatorConfig = {
  targetPairCost: 0.98,
  tradeSize: 2,
  maxUnhedgedDelta: 4,
  minLiquidityMultiplier: 3,
  maxExposurePerMarketUsd: 5,
};

const PAPER_EQUALIZER: EqualizerConfig = {
  imbalanceThreshold: 1,
  tradeSize: 2,
  maxPairCost: 0.99,
};

const PAPER_RISK: RiskConfig = {
  maxExposureUsd: 12,
  maxExposurePerMarketUsd: 5,
  maxDrawdownPct: 0.20,
  maxOpenOrders: 4,
  startingBalanceUsd: 15,
};

const SMALL_LIVE_ACCUMULATOR: AccumulatorConfig = {
  targetPairCost: 0.98,
  tradeSize: 1,
  maxUnhedgedDelta: 2,
  minLiquidityMultiplier: 3,
  maxExposurePerMarketUsd: 2,
};

const SMALL_LIVE_EQUALIZER: EqualizerConfig = {
  imbalanceThreshold: 0,
  tradeSize: 1,
  maxPairCost: 0.99,
};

const SMALL_LIVE_RISK: RiskConfig = {
  maxExposureUsd: 2,
  maxExposurePerMarketUsd: 2,
  maxDrawdownPct: 0.20,
  maxOpenOrders: 1,
  startingBalanceUsd: 15,
};

export function loadLiveModeConfig(env: NodeJS.ProcessEnv): LiveModeConfig {
  const mode: TradingMode = env.TRADING_MODE === 'small_live' ? 'small_live' : 'paper';
  const liveEnabled = env.ENABLE_LIVE_TRADING === 'true';
  const canPlaceLiveOrders = mode === 'small_live' && liveEnabled;

  if (mode === 'small_live') {
    return {
      mode,
      liveEnabled,
      canPlaceLiveOrders,
      accumulator: SMALL_LIVE_ACCUMULATOR,
      equalizer: SMALL_LIVE_EQUALIZER,
      risk: SMALL_LIVE_RISK,
    };
  }

  return {
    mode,
    liveEnabled,
    canPlaceLiveOrders: false,
    accumulator: PAPER_ACCUMULATOR,
    equalizer: PAPER_EQUALIZER,
    risk: PAPER_RISK,
  };
}
```

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npm test -- tests/config/live-mode.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config/live-mode.ts tests/config/live-mode.test.ts
git commit -m "feat(config): add fail-closed small live mode gate"
```

---

## Task 2: Fill Tracker Updates Positions Only From Observed Fills

**Files:**
- Create: `src/execution/live-fill-tracker.ts`
- Create: `tests/execution/live-fill-tracker.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/execution/live-fill-tracker.test.ts`:

```ts
import { applyObservedFills, ObservedFill } from '../../src/execution/live-fill-tracker';
import { PositionTracker } from '../../src/strategy/position-tracker';

describe('applyObservedFills', () => {
  it('updates tracker from confirmed fills', () => {
    const tracker = new PositionTracker();
    const fills: ObservedFill[] = [
      { id: 'fill-1', marketId: 'cid-1', side: 'YES', price: 0.42, sizeShares: 1, marketEndMs: 2_000 },
    ];

    const applied = applyObservedFills(tracker, fills, new Set());

    expect(applied).toHaveLength(1);
    expect(tracker.getPosition('cid-1')).toMatchObject({ yesQty: 1, avgYesPrice: 0.42, marketEndMs: 2_000 });
  });

  it('does not apply the same fill twice', () => {
    const tracker = new PositionTracker();
    const seen = new Set<string>(['fill-1']);
    const fills: ObservedFill[] = [
      { id: 'fill-1', marketId: 'cid-1', side: 'YES', price: 0.42, sizeShares: 1, marketEndMs: 2_000 },
    ];

    const applied = applyObservedFills(tracker, fills, seen);

    expect(applied).toEqual([]);
    expect(tracker.getPosition('cid-1')).toBeNull();
  });
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- tests/execution/live-fill-tracker.test.ts --runInBand
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement fill tracker**

Create `src/execution/live-fill-tracker.ts`:

```ts
import { PositionTracker } from '../strategy/position-tracker';

export interface ObservedFill {
  id: string;
  marketId: string;
  side: 'YES' | 'NO';
  price: number;
  sizeShares: number;
  marketEndMs?: number;
}

export function applyObservedFills(
  tracker: PositionTracker,
  fills: ObservedFill[],
  seenFillIds: Set<string>,
): ObservedFill[] {
  const applied: ObservedFill[] = [];

  for (const fill of fills) {
    if (seenFillIds.has(fill.id)) continue;
    tracker.updateFill(fill.marketId, fill.side, fill.price, fill.sizeShares, fill.marketEndMs);
    seenFillIds.add(fill.id);
    applied.push(fill);
  }

  return applied;
}
```

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npm test -- tests/execution/live-fill-tracker.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/execution/live-fill-tracker.ts tests/execution/live-fill-tracker.test.ts
git commit -m "feat(execution): apply live fills to tracker once"
```

---

## Task 3: Live Order Client Adapter With Mocked CLOB Client

**Files:**
- Create: `src/execution/polymarket-live-order-client.ts`
- Create: `tests/execution/polymarket-live-order-client.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/execution/polymarket-live-order-client.test.ts`:

```ts
import { PolymarketLiveOrderClient } from '../../src/execution/polymarket-live-order-client';

describe('PolymarketLiveOrderClient', () => {
  it('creates post-only BUY order through injected client', async () => {
    const clob = {
      createOrder: jest.fn().mockResolvedValue({ id: 'order-1' }),
      cancelOrder: jest.fn(),
      getOpenOrders: jest.fn(),
    };
    const client = new PolymarketLiveOrderClient(clob as any);

    const result = await client.createOrder({ tokenId: 'token-1', side: 'BUY', price: 0.42, size: 1 });

    expect(result).toEqual({ orderId: 'order-1', status: 'LIVE' });
    expect(clob.createOrder).toHaveBeenCalledWith(expect.objectContaining({
      tokenID: 'token-1',
      side: 'BUY',
      price: 0.42,
      size: 1,
      postOnly: true,
    }));
  });

  it('normalizes create order errors', async () => {
    const clob = {
      createOrder: jest.fn().mockRejectedValue(new Error('bad order')),
      cancelOrder: jest.fn(),
      getOpenOrders: jest.fn(),
    };
    const client = new PolymarketLiveOrderClient(clob as any);

    const result = await client.createOrder({ tokenId: 'token-1', side: 'BUY', price: 0.42, size: 1 });

    expect(result.status).toBe('ERROR');
    expect(result.error).toContain('bad order');
  });
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- tests/execution/polymarket-live-order-client.test.ts --runInBand
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement adapter**

Create `src/execution/polymarket-live-order-client.ts`:

```ts
import { ClobOrderClient, OpenOrder, OrderResult } from './order-manager';

export interface MinimalPolymarketClobClient {
  createOrder(params: Record<string, unknown>): Promise<{ id?: string; orderId?: string }>;
  cancelOrder(orderId: string): Promise<void>;
  getOpenOrders(): Promise<Array<{ id?: string; orderId?: string; tokenID?: string; tokenId?: string; createdAt?: number }>>;
}

export class PolymarketLiveOrderClient implements ClobOrderClient {
  constructor(private clob: MinimalPolymarketClobClient) {}

  async createOrder(params: { tokenId: string; side: string; price: number; size: number }): Promise<OrderResult> {
    try {
      const order = await this.clob.createOrder({
        tokenID: params.tokenId,
        side: params.side,
        price: params.price,
        size: params.size,
        postOnly: true,
      });
      return { orderId: order.id ?? order.orderId ?? null, status: 'LIVE' };
    } catch (err) {
      return { orderId: null, status: 'ERROR', error: (err as Error).message };
    }
  }

  async cancelOrder(orderId: string): Promise<void> {
    await this.clob.cancelOrder(orderId);
  }

  async getOpenOrders(): Promise<OpenOrder[]> {
    const orders = await this.clob.getOpenOrders();
    return orders.map((o) => ({
      orderId: o.id ?? o.orderId ?? '',
      tokenId: o.tokenID ?? o.tokenId ?? '',
      createdAt: o.createdAt ?? Date.now(),
    })).filter((o) => o.orderId.length > 0);
  }
}
```

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npm test -- tests/execution/polymarket-live-order-client.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/execution/polymarket-live-order-client.ts tests/execution/polymarket-live-order-client.test.ts
git commit -m "feat(execution): add polymarket live order adapter"
```

---

## Task 4: Runner Mode Selection Without Business Logic Changes

**Files:**
- Modify: `src/run-accumulator.ts`
- Test: `tests/config/live-mode.test.ts`

- [ ] **Step 1: Write failing test for exported config consistency**

Append to `tests/config/live-mode.test.ts`:

```ts
  it('keeps paper limits unchanged for business-logic soak', () => {
    const cfg = loadLiveModeConfig({ TRADING_MODE: 'paper' });

    expect(cfg.accumulator.targetPairCost).toBe(0.98);
    expect(cfg.accumulator.tradeSize).toBe(2);
    expect(cfg.equalizer.maxPairCost).toBe(0.99);
    expect(cfg.risk.maxExposureUsd).toBe(12);
  });
```

- [ ] **Step 2: Verify test still passes**

Run:

```bash
npm test -- tests/config/live-mode.test.ts --runInBand
```

Expected: PASS. If it fails, config is inconsistent and must be fixed before runner changes.

- [ ] **Step 3: Modify runner to read config**

In `src/run-accumulator.ts`, replace hardcoded config constants with:

```ts
import { loadLiveModeConfig } from './config/live-mode';
```

Inside `main()` after env variables:

```ts
const modeConfig = loadLiveModeConfig(process.env);
const ACCUMULATOR_CONFIG = modeConfig.accumulator;
const EQUALIZER_CONFIG = modeConfig.equalizer;
const RISK_CONFIG = modeConfig.risk;
```

Keep the existing paper `orderManager` branch when `!modeConfig.canPlaceLiveOrders`.

For this task, do not instantiate a real CLOB client yet. If `modeConfig.canPlaceLiveOrders` is true, throw:

```ts
throw new Error('small_live execution adapter is not wired yet');
```

This preserves fail-closed behavior while config is introduced.

- [ ] **Step 4: Build and tests**

Run:

```bash
npm run build
npm test -- --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/run-accumulator.ts tests/config/live-mode.test.ts
git commit -m "feat(runner): load fail-closed trading mode config"
```

---

## Task 5: Non-Regression Business Logic Guard

**Files:**
- Existing tests only:
  - `tests/engines/accumulator.test.ts`
  - `tests/engines/equalizer.test.ts`
  - `tests/data/fifteen-min-scanner.test.ts`

- [ ] **Step 1: Run business logic tests before live wiring**

Run:

```bash
npm test -- tests/engines/accumulator.test.ts tests/engines/equalizer.test.ts tests/data/fifteen-min-scanner.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 2: Confirm no diff in business logic files**

Run:

```bash
git diff -- src/engines/accumulator.ts src/engines/equalizer.ts src/data/fifteen-min-scanner.ts
```

Expected: no output.

If there is output, stop and ask for review. Do not proceed to live wiring.

---

## Task 6: Wire Small Live Adapter Behind Explicit Gates

**Files:**
- Modify: `src/run-accumulator.ts`
- Test: manual build/full tests only; adapter itself is unit tested.

- [ ] **Step 1: Add live adapter construction behind gates**

In `src/run-accumulator.ts`, import:

```ts
import { ClobClient, Chain } from '@polymarket/clob-client-v2';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { polygon } from 'viem/chains';
import { OrderManager } from './execution/order-manager';
import { PolymarketLiveOrderClient } from './execution/polymarket-live-order-client';
```

Add a helper:

```ts
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for small_live`);
  return value;
}

function createSmallLiveOrderManager(clobBaseUrl: string): OrderManager {
  const privateKey = requireEnv('PRIVATE_KEY');
  const walletAddress = requireEnv('WALLET_ADDRESS');
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const walletClient = createWalletClient({ account, chain: polygon, transport: http() });
  const clobClient = new ClobClient({
    host: clobBaseUrl,
    chain: Chain.POLYGON,
    signer: walletClient,
    signatureType: 3,
    funderAddress: walletAddress,
  });
  return new OrderManager(new PolymarketLiveOrderClient(clobClient as any));
}
```

Then replace order manager selection with:

```ts
const orderManager = modeConfig.canPlaceLiveOrders
  ? createSmallLiveOrderManager(clobBaseUrl)
  : paperOrderManager;
```

Ensure console says `PAPER` or `SMALL_LIVE` clearly.

- [ ] **Step 2: Build and full test**

Run:

```bash
npm run build
npm test -- --runInBand
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/run-accumulator.ts
git commit -m "feat(runner): wire small live order manager behind gates"
```

---

## Task 7: Final Verification and Deployment

**Files:**
- No code changes unless verification fails.

- [ ] **Step 1: Full local verification**

Run:

```bash
npm run build
npm test -- --runInBand
```

Expected: PASS.

- [ ] **Step 2: Confirm business logic files unchanged from pre-live commits**

Run:

```bash
git diff HEAD~3..HEAD -- src/engines/accumulator.ts src/engines/equalizer.ts src/data/fifteen-min-scanner.ts
```

Expected: no output.

- [ ] **Step 3: Push**

```bash
git push origin main
```

- [ ] **Step 4: Deploy paper default first**

On production:

```bash
ssh -i ~/.ssh/polymarket-mm-key.pem -o StrictHostKeyChecking=no ubuntu@54.154.79.239 '
cd /home/ubuntu/polymarketmm
git pull origin main
docker compose down
docker compose up -d --build
'
```

Expected: service starts in PAPER mode unless env gates are present.

- [ ] **Step 5: Verify paper default logs**

```bash
ssh -i ~/.ssh/polymarket-mm-key.pem -o StrictHostKeyChecking=no ubuntu@54.154.79.239 'docker logs --tail 30 polymarket-pair-cost-foundation'
```

Expected: logs show `PAPER mode`; no live order placement.

- [ ] **Step 6: Enable small live only after explicit human confirmation**

Do not set production live env variables in this plan execution without a separate explicit user message saying to enable live now.

---

## Self-Review

- Spec coverage: live gates, `$2` risk, one share trade size, fill-only tracking, settlement buffer/order lifecycle, logging, tests, and deployment are covered.
- Business logic protection: Task 5 explicitly verifies no changes to accumulator/equalizer/scanner files.
- Placeholder scan: no TBD/TODO/placeholder instructions remain.
- Type consistency: `AccumulatorConfig`, `EqualizerConfig`, `RiskConfig`, `OrderManager`, and `PositionTracker` names match existing code.
