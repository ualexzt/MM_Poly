# Small Live Safety and Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `small_live` safe for a 10 USDC / 2-market envelope, with accurate live accounting, profitability filters, shadow-first deployment, and Telegram alerts/reports.

**Architecture:** Keep production disabled by default and add pure, testable risk/accounting/reporting modules around the existing strategy runner. Live execution must be gated by explicit startup checks and runtime checks using CLOB open orders, CLOB balance/allowance, Data API positions, submit responses, and user WebSocket confirmations.

**Tech Stack:** TypeScript, Jest, `@polymarket/clob-client-v2`, Polymarket Data API, Telegram Bot API, Docker Compose on AWS EC2.

---

## File Structure

### Create

- `src/risk/live-account-risk.ts`
  - Pure evaluator for open orders, positions, balance, and configured risk envelope.
- `tests/risk/live-account-risk.test.ts`
  - Unit tests for startup/runtime blockers and warnings.
- `src/reporting/small-live-telegram-report.ts`
  - Pure formatting for Telegram 3-hour reports and critical alerts.
- `tests/reporting/small-live-telegram-report.test.ts`
  - Unit tests for compact Telegram report formatting.
- `src/monitoring/small-live-metrics.ts`
  - Small in-memory counters for fills, rejects, submissions, alerts, and cycle lag since the last report.
- `tests/monitoring/small-live-metrics.test.ts`
  - Unit tests for metrics increments and report-window reset.

### Modify

- `src/config/env.ts`
  - Add report interval and live safety env parsing.
- `.env.example`
  - Document safe defaults.
- `src/types/config.ts`
  - Add book/pathological-market filter fields if needed.
- `src/strategy/config.ts`
  - Configure pathological book rejection and live book stale threshold.
- `src/strategy/market-selector.ts`
  - Reject pathological books such as `bestBid=0.001`, `bestAsk=0.999`.
- `tests/strategy/market-selector.test.ts`
  - Add pathological book filter tests.
- `src/execution/live-order-submitter.ts`
  - Keep returning immediate fill information from `takingAmount` / `makingAmount`; add tests if missing.
- `src/execution/order-router.ts`
  - Keep passing immediate fill information through `RouteResult`; add tests if missing.
- `src/strategy/strategy-runner.ts`
  - Keep applying immediate matched fills to internal inventory; add runtime balance guard before submit.
- `tests/strategy/strategy-runner.test.ts`
  - Add tests proving matched submit response updates inventory and permits SELL later.
- `src/strategy/small-live-preflight.ts`
  - Add live safety blockers for max markets/exposure/Telegram/balance/open-order state.
- `tests/strategy/small-live-preflight.test.ts`
  - Add startup blocker tests.
- `src/strategy/small-live-runner.ts`
  - Add account snapshot plumbing, Telegram report scheduling, reject counters, and stop-new-orders behavior.
- `src/run-small-live.ts`
  - Wire snapshot collection and 3-hour reports into runtime.

---

## Task 1: Lock Production Safety Defaults and Env Surface

**Files:**
- Modify: `src/config/env.ts`
- Modify: `.env.example`
- Test: `tests/invariants/runtime.test.ts`

- [ ] **Step 1: Write failing tests for new env defaults**

Add to `tests/invariants/runtime.test.ts`:

```ts
test('small_live safety env defaults are conservative', () => {
  jest.resetModules();
  process.env = {
    ...ORIGINAL_ENV,
    TELEGRAM_BOT_TOKEN: 'test-token',
    TELEGRAM_CHAT_ID: 'test-chat',
    MODE: undefined,
    LIVE_TRADING_ENABLED: undefined,
    MAX_MARKETS: undefined,
    MAX_EXPOSURE_USD: undefined,
    TELEGRAM_REPORT_INTERVAL_HOURS: undefined,
  };

  const env = require('../../src/config/env').env;

  expect(env.mode).toBe('paper');
  expect(env.liveTradingEnabled).toBe(false);
  expect(env.maxMarkets).toBeLessThanOrEqual(2);
  expect(env.maxExposureUsd).toBeLessThanOrEqual(10);
  expect(env.telegramReportIntervalHours).toBe(3);

  process.env = ORIGINAL_ENV;
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx jest tests/invariants/runtime.test.ts --no-coverage
```

Expected: FAIL because `telegramReportIntervalHours` does not exist and current defaults are not small-live-safe.

- [ ] **Step 3: Implement env field and safe defaults**

In `src/config/env.ts`, add to `EnvConfig`:

```ts
telegramReportIntervalHours: number;
```

Change defaults in the exported `env` object:

```ts
maxExposureUsd: getEnvFloat('MAX_EXPOSURE_USD', 10),
maxMarkets: getEnvInt('MAX_MARKETS', 2),
telegramReportIntervalHours: getEnvFloat('TELEGRAM_REPORT_INTERVAL_HOURS', 3),
```

In `.env.example`, document:

```env
# Small-live safety defaults. Increase only after shadow verification.
MAX_MARKETS=2
MAX_EXPOSURE_USD=10
TELEGRAM_REPORT_INTERVAL_HOURS=3
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx jest tests/invariants/runtime.test.ts --no-coverage
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config/env.ts .env.example tests/invariants/runtime.test.ts
git commit -m "fix(config): default small live to conservative limits"
```

---

## Task 2: Add Pure Live Account Risk Evaluator

**Files:**
- Create: `src/risk/live-account-risk.ts`
- Create: `tests/risk/live-account-risk.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/risk/live-account-risk.test.ts`:

```ts
import { evaluateLiveAccountRisk } from '../../src/risk/live-account-risk';

describe('live-account-risk', () => {
  test('blocks live when open orders exceed internal expectation', () => {
    const result = evaluateLiveAccountRisk({
      mode: 'small_live',
      liveTradingEnabled: true,
      maxMarkets: 2,
      maxExposureUsd: 10,
      telegramConfigured: true,
      telegramHealthy: true,
      collateralBalanceUsd: 15,
      openOrderNotionalUsd: 4,
      expectedOpenOrderNotionalUsd: 0,
      positionsValueUsd: 0,
      minRequiredOrderUsd: 1.5,
      submitRejectsLastWindow: 0,
    });

    expect(result.ok).toBe(false);
    expect(result.blockers).toContain('open_order_leak');
  });

  test('blocks live when projected active exposure exceeds envelope', () => {
    const result = evaluateLiveAccountRisk({
      mode: 'small_live',
      liveTradingEnabled: true,
      maxMarkets: 2,
      maxExposureUsd: 10,
      telegramConfigured: true,
      telegramHealthy: true,
      collateralBalanceUsd: 15,
      openOrderNotionalUsd: 9,
      expectedOpenOrderNotionalUsd: 9,
      positionsValueUsd: 2,
      minRequiredOrderUsd: 1.5,
      submitRejectsLastWindow: 0,
    });

    expect(result.ok).toBe(false);
    expect(result.blockers).toContain('active_exposure_above_limit');
  });

  test('warns but does not block when free balance is only slightly above one order', () => {
    const result = evaluateLiveAccountRisk({
      mode: 'small_live',
      liveTradingEnabled: true,
      maxMarkets: 1,
      maxExposureUsd: 10,
      telegramConfigured: true,
      telegramHealthy: true,
      collateralBalanceUsd: 3,
      openOrderNotionalUsd: 1.3,
      expectedOpenOrderNotionalUsd: 1.3,
      positionsValueUsd: 0,
      minRequiredOrderUsd: 1.3,
      submitRejectsLastWindow: 0,
    });

    expect(result.ok).toBe(true);
    expect(result.warnings).toContain('low_free_balance');
  });

  test('blocks live when Telegram is unavailable', () => {
    const result = evaluateLiveAccountRisk({
      mode: 'small_live',
      liveTradingEnabled: true,
      maxMarkets: 2,
      maxExposureUsd: 10,
      telegramConfigured: true,
      telegramHealthy: false,
      collateralBalanceUsd: 15,
      openOrderNotionalUsd: 0,
      expectedOpenOrderNotionalUsd: 0,
      positionsValueUsd: 0,
      minRequiredOrderUsd: 1.5,
      submitRejectsLastWindow: 0,
    });

    expect(result.ok).toBe(false);
    expect(result.blockers).toContain('telegram_unhealthy');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest tests/risk/live-account-risk.test.ts --no-coverage
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement pure evaluator**

Create `src/risk/live-account-risk.ts`:

```ts
export type LiveAccountBlocker =
  | 'mode_not_small_live'
  | 'live_trading_disabled'
  | 'max_markets_above_approved_limit'
  | 'max_exposure_above_approved_limit'
  | 'telegram_missing'
  | 'telegram_unhealthy'
  | 'balance_below_min_order'
  | 'open_order_leak'
  | 'active_exposure_above_limit'
  | 'submit_rejects_above_threshold';

export type LiveAccountWarning = 'low_free_balance' | 'positions_present' | 'open_orders_present';

export interface LiveAccountRiskInput {
  mode: 'paper' | 'shadow' | 'small_live' | 'disabled';
  liveTradingEnabled: boolean;
  maxMarkets: number;
  maxExposureUsd: number;
  telegramConfigured: boolean;
  telegramHealthy: boolean;
  collateralBalanceUsd: number;
  openOrderNotionalUsd: number;
  expectedOpenOrderNotionalUsd: number;
  positionsValueUsd: number;
  minRequiredOrderUsd: number;
  submitRejectsLastWindow: number;
}

export interface LiveAccountRiskResult {
  ok: boolean;
  blockers: LiveAccountBlocker[];
  warnings: LiveAccountWarning[];
  freeCollateralUsd: number;
  activeExposureUsd: number;
}

const APPROVED_MAX_MARKETS = 2;
const APPROVED_MAX_EXPOSURE_USD = 10;
const OPEN_ORDER_LEAK_TOLERANCE_USD = 0.05;
const SUBMIT_REJECT_LIMIT = 3;

export function evaluateLiveAccountRisk(input: LiveAccountRiskInput): LiveAccountRiskResult {
  const blockers: LiveAccountBlocker[] = [];
  const warnings: LiveAccountWarning[] = [];
  const freeCollateralUsd = input.collateralBalanceUsd - input.openOrderNotionalUsd;
  const activeExposureUsd = input.openOrderNotionalUsd + input.positionsValueUsd;

  if (input.mode !== 'small_live') blockers.push('mode_not_small_live');
  if (!input.liveTradingEnabled) blockers.push('live_trading_disabled');
  if (input.maxMarkets > APPROVED_MAX_MARKETS) blockers.push('max_markets_above_approved_limit');
  if (input.maxExposureUsd > APPROVED_MAX_EXPOSURE_USD) blockers.push('max_exposure_above_approved_limit');
  if (!input.telegramConfigured) blockers.push('telegram_missing');
  if (input.telegramConfigured && !input.telegramHealthy) blockers.push('telegram_unhealthy');
  if (freeCollateralUsd < input.minRequiredOrderUsd) blockers.push('balance_below_min_order');
  if (input.openOrderNotionalUsd - input.expectedOpenOrderNotionalUsd > OPEN_ORDER_LEAK_TOLERANCE_USD) blockers.push('open_order_leak');
  if (activeExposureUsd > input.maxExposureUsd) blockers.push('active_exposure_above_limit');
  if (input.submitRejectsLastWindow >= SUBMIT_REJECT_LIMIT) blockers.push('submit_rejects_above_threshold');

  if (input.positionsValueUsd > 0) warnings.push('positions_present');
  if (input.openOrderNotionalUsd > 0) warnings.push('open_orders_present');
  if (freeCollateralUsd >= input.minRequiredOrderUsd && freeCollateralUsd < input.minRequiredOrderUsd * 2) warnings.push('low_free_balance');

  return { ok: blockers.length === 0, blockers, warnings, freeCollateralUsd, activeExposureUsd };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest tests/risk/live-account-risk.test.ts --no-coverage
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/risk/live-account-risk.ts tests/risk/live-account-risk.test.ts
git commit -m "feat(risk): add live account risk evaluator"
```

---

## Task 3: Harden Preflight for Approved Live Envelope

**Files:**
- Modify: `src/strategy/small-live-preflight.ts`
- Modify: `tests/strategy/small-live-preflight.test.ts`

- [ ] **Step 1: Write failing preflight tests**

Add to `tests/strategy/small-live-preflight.test.ts`:

```ts
test('blocks small_live when maxMarkets exceeds approved envelope', () => {
  const result = validateSmallLiveStartupEnv({ ...baseEnv, maxMarkets: 3 });

  expect(result.ok).toBe(false);
  expect(result.blockers).toContain('max_markets_above_approved_limit');
});

test('blocks small_live when maxExposureUsd exceeds approved envelope', () => {
  const result = validateSmallLiveStartupEnv({ ...baseEnv, maxExposureUsd: 11 });

  expect(result.ok).toBe(false);
  expect(result.blockers).toContain('max_exposure_above_approved_limit');
});

test('blocks small_live when Telegram credentials are missing', () => {
  const result = validateSmallLiveStartupEnv({ ...baseEnv, telegramBotToken: '', telegramChatId: '' });

  expect(result.ok).toBe(false);
  expect(result.blockers).toContain('telegram_missing');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest tests/strategy/small-live-preflight.test.ts --no-coverage
```

Expected: FAIL because blockers do not exist.

- [ ] **Step 3: Implement blockers**

In `src/strategy/small-live-preflight.ts`, extend `SmallLiveStartupBlocker`:

```ts
  | 'max_markets_above_approved_limit'
  | 'max_exposure_above_approved_limit'
  | 'telegram_missing'
```

Add constants and checks in `validateSmallLiveStartupEnv`:

```ts
const APPROVED_SMALL_LIVE_MAX_MARKETS = 2;
const APPROVED_SMALL_LIVE_MAX_EXPOSURE_USD = 10;

if (envConfig.maxMarkets > APPROVED_SMALL_LIVE_MAX_MARKETS) blockers.push('max_markets_above_approved_limit');
if (envConfig.maxExposureUsd > APPROVED_SMALL_LIVE_MAX_EXPOSURE_USD) blockers.push('max_exposure_above_approved_limit');
if (!hasText(envConfig.telegramBotToken) || !hasText(envConfig.telegramChatId)) blockers.push('telegram_missing');
```

Keep the existing `notifyStartupBlockers` behavior. If `telegram_missing` is present, logging a warning instead of sending is acceptable because no credentials exist.

- [ ] **Step 4: Run tests to verify pass**

```bash
npx jest tests/strategy/small-live-preflight.test.ts --no-coverage
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/strategy/small-live-preflight.ts tests/strategy/small-live-preflight.test.ts
git commit -m "fix(preflight): enforce approved small live envelope"
```

---

## Task 4: Verify Immediate Matched Fill Accounting with Tests

**Files:**
- Modify: `tests/execution/execution-modules.test.ts`
- Modify: `tests/strategy/strategy-runner.test.ts`
- Modify if needed: `src/execution/live-order-submitter.ts`
- Modify if needed: `src/execution/order-router.ts`
- Modify if needed: `src/strategy/strategy-runner.ts`

- [ ] **Step 1: Add router test for matched response fill info**

In `tests/execution/execution-modules.test.ts`, update the existing live submit test expectation to match current implementation using string values, then add:

```ts
test('returns immediate fill details for matched live orders', async () => {
  const paperEngine = new PaperExecutionEngine();
  const mockClient = {
    createAndPostOrder: jest.fn().mockResolvedValue({
      orderID: 'live-filled-1',
      status: 'matched',
      takingAmount: '6',
      makingAmount: '1.5',
    }),
    cancelOrder: jest.fn().mockResolvedValue({}),
    getOpenOrders: jest.fn().mockResolvedValue([]),
  };
  const liveSubmitter = new LiveOrderSubmitter(mockClient as any);
  const router = new OrderRouter(paperEngine, { mode: 'small_live', liveTradingEnabled: true }, liveSubmitter);

  const quote: QuoteCandidate = {
    conditionId: 'c1', tokenId: 'yes1', side: 'BUY', price: 0.25, size: 6, sizeUsd: 1.5,
    postOnly: true, orderType: 'GTC', fairPrice: 0.50, targetHalfSpreadCents: 5,
    inventorySkewCents: 0, toxicityScore: 0, reason: 'test', riskFlags: []
  };

  const book: BookState = {
    tokenId: 'yes1', conditionId: 'c1',
    bids: [], asks: [],
    bestBid: 0.24, bestAsk: 0.30,
    bestBidSizeUsd: 100, bestAskSizeUsd: 100,
    midpoint: 0.27, spread: 0.06, spreadTicks: 6,
    depth1Usd: 100, depth3Usd: 500,
    tickSize: 0.01, minOrderSize: 5,
    lastUpdateMs: Date.now()
  };

  const result = await router.route(quote, book, null, {
    exposureAllowed: true,
    sellInventoryAvailable: true,
    killSwitchActive: false,
  });

  expect(result).toMatchObject({
    submitted: true,
    orderId: 'live-filled-1',
    filledSize: 6,
    filledPrice: 0.25,
  });
});
```

- [ ] **Step 2: Add strategy test for inventory after matched response**

In `tests/strategy/strategy-runner.test.ts`, add a test using a one-market scanner, a book with `minOrderSize: 5`, and a mock client that returns matched on first BUY. The assertion should run two cycles and verify the second cycle attempts a SELL because inventory now exists:

```ts
test('tracks immediate matched live buy so next cycle can quote sell', async () => {
  const market: MarketState = {
    conditionId: 'cond-1', yesTokenId: 'yes1', noTokenId: 'no1', active: true, closed: false,
    enableOrderBook: true, feesEnabled: true, volume24hUsd: 25000, liquidityUsd: 15000,
    oracleAmbiguityScore: 0.05, resolutionSource: 'https://example.com',
  };
  const bookClient = {
    async fetchBook(conditionId: string, tokenId: string): Promise<BookState> {
      return {
        tokenId, conditionId,
        bids: [{ price: 0.24, size: 100, sizeUsd: 24 }],
        asks: [{ price: 0.30, size: 100, sizeUsd: 30 }],
        bestBid: 0.24, bestAsk: 0.30,
        bestBidSizeUsd: 24, bestAskSizeUsd: 30,
        midpoint: 0.27, spread: 0.06, spreadTicks: 6,
        depth1Usd: 54, depth3Usd: 500,
        tickSize: 0.01, minOrderSize: 5,
        lastUpdateMs: Date.now(),
      };
    },
  };
  const mockClient = {
    createAndPostOrder: jest.fn()
      .mockResolvedValueOnce({ orderID: 'buy-filled', status: 'matched', takingAmount: '6', makingAmount: '1.5' })
      .mockResolvedValue({ orderID: 'sell-live', status: 'live' }),
    cancelOrder: jest.fn().mockResolvedValue({}),
    getOpenOrders: jest.fn().mockResolvedValue([]),
  };

  const runner = createSmallLiveStrategyRunner({
    envConfig: { ...envConfig, maxMarkets: 1, maxExposureUsd: 10 },
    scanner: { fetchMarkets: async () => [market] },
    bookClient,
    paperEngine: new PaperExecutionEngine(),
    liveSubmitter: new LiveOrderSubmitter(mockClient as any),
    logger: silentLogger,
  });

  await runner.runCycle();
  await runner.runCycle();

  expect(mockClient.createAndPostOrder).toHaveBeenCalledWith(
    expect.objectContaining({ tokenID: 'yes1', side: 'SELL' }),
    expect.anything(),
    'GTC'
  );
});
```

- [ ] **Step 3: Run tests to verify current behavior**

```bash
npx jest tests/execution/execution-modules.test.ts tests/strategy/strategy-runner.test.ts --no-coverage
```

Expected: PASS if `bb1ce0a` already fixed it; otherwise FAIL showing where fill info is not propagated.

- [ ] **Step 4: Implement minimal missing fill propagation if tests fail**

If needed, ensure these signatures exist:

```ts
export interface LiveOrderResult {
  orderID: string;
  filledSize?: number;
  filledPrice?: number;
}
```

`LiveOrderSubmitter.submit()` returns:

```ts
const takingAmount = parseFloat(resp.takingAmount || '0');
const makingAmount = parseFloat(resp.makingAmount || '0');
const filledSize = takingAmount > 0 ? takingAmount : undefined;
const filledPrice = (filledSize && filledSize > 0) ? (makingAmount / filledSize) : undefined;
return { orderID: resp.orderID, filledSize, filledPrice };
```

`StrategyRunner.processMarket()` applies immediate fill:

```ts
if (config.mode === 'small_live' && routeResult.filledSize && routeResult.filledSize > 0) {
  this.onFill(market.conditionId, market.yesTokenId, side, routeResult.filledPrice ?? candidate.price, routeResult.filledSize);
}
```

- [ ] **Step 5: Run tests to verify pass**

```bash
npx jest tests/execution/execution-modules.test.ts tests/strategy/strategy-runner.test.ts --no-coverage
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/execution/live-order-submitter.ts src/execution/order-router.ts src/strategy/strategy-runner.ts tests/execution/execution-modules.test.ts tests/strategy/strategy-runner.test.ts
git commit -m "fix(live): verify immediate matched fills update inventory"
```

---

## Task 5: Add Pathological Book and Minimum Edge Filters

**Files:**
- Modify: `src/types/config.ts`
- Modify: `src/strategy/config.ts`
- Modify: `src/strategy/market-selector.ts`
- Modify/Create: `tests/strategy/market-selector.test.ts`

- [ ] **Step 1: Write failing market selector tests**

Add to `tests/strategy/market-selector.test.ts`:

```ts
import { isMarketEligible } from '../../src/strategy/market-selector';
import { defaultConfig } from '../../src/strategy/config';
import type { MarketState } from '../../src/types/market';
import type { BookState } from '../../src/types/book';

const market: MarketState = {
  conditionId: 'cond-1', yesTokenId: 'yes1', noTokenId: 'no1', active: true, closed: false,
  enableOrderBook: true, feesEnabled: true, volume24hUsd: 25000, liquidityUsd: 15000,
  oracleAmbiguityScore: 0.05, resolutionSource: 'https://example.com',
};

function book(overrides: Partial<BookState>): BookState {
  return {
    tokenId: 'yes1', conditionId: 'cond-1',
    bids: [{ price: 0.24, size: 100, sizeUsd: 24 }],
    asks: [{ price: 0.30, size: 100, sizeUsd: 30 }],
    bestBid: 0.24, bestAsk: 0.30,
    bestBidSizeUsd: 24, bestAskSizeUsd: 30,
    midpoint: 0.27, spread: 0.06, spreadTicks: 6,
    depth1Usd: 54, depth3Usd: 500,
    tickSize: 0.01, minOrderSize: 5,
    lastUpdateMs: Date.now(),
    ...overrides,
  };
}

test('rejects pathological 0.001 x 0.999 books', () => {
  const books = new Map<string, BookState>([
    ['yes1', book({
      bestBid: 0.001,
      bestAsk: 0.999,
      midpoint: 0.5,
      spread: 0.998,
      spreadTicks: 998,
      bestBidSizeUsd: 0.1,
      bestAskSizeUsd: 0.1,
      depth1Usd: 0.2,
      depth3Usd: 0.5,
      tickSize: 0.001,
    })],
  ]);

  expect(isMarketEligible(market, {
    ...defaultConfig.marketFilter,
    minBestLevelDepthUsd: 0,
    minDepth3LevelsUsd: 0,
    maxSpreadCents: 100,
  }, books)).toBe(false);
});

test('rejects when min order consumes too much of live exposure budget', () => {
  const books = new Map<string, BookState>([
    ['yes1', book({ bestBid: 0.45, bestAsk: 0.55, midpoint: 0.5, minOrderSize: 5 })],
  ]);

  expect(isMarketEligible(market, {
    ...defaultConfig.marketFilter,
    maxMinOrderExposurePct: 20,
  }, books)).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify fail**

```bash
npx jest tests/strategy/market-selector.test.ts --no-coverage
```

Expected: FAIL because `maxMinOrderExposurePct` does not exist and pathological book is not rejected.

- [ ] **Step 3: Extend config types**

In `src/types/config.ts`, add to `MarketFilterConfig`:

```ts
rejectPathologicalWideBooks: boolean;
pathologicalBestBidLte: number;
pathologicalBestAskGte: number;
maxMinOrderExposurePct: number;
```

In `src/strategy/config.ts`, add to `marketFilter`:

```ts
rejectPathologicalWideBooks: true,
pathologicalBestBidLte: 0.001,
pathologicalBestAskGte: 0.999,
maxMinOrderExposurePct: 20,
```

- [ ] **Step 4: Implement filters**

In `src/strategy/market-selector.ts`, inside the `if (books)` block after midpoint validation:

```ts
    if (
      config.rejectPathologicalWideBooks &&
      yesBook.bestBid !== null &&
      yesBook.bestAsk !== null &&
      yesBook.bestBid <= config.pathologicalBestBidLte &&
      yesBook.bestAsk >= config.pathologicalBestAskGte
    ) {
      return false;
    }

    const minOrderUsd = yesBook.minOrderSize * (yesBook.midpoint ?? 0);
    const maxMinOrderUsd = (config.maxMinOrderExposurePct / 100) * 10;
    if (minOrderUsd > maxMinOrderUsd) return false;
```

Use `10` here because the approved small-live envelope is 10 USDC. Do not add another env variable in this task.

- [ ] **Step 5: Run tests to verify pass**

```bash
npx jest tests/strategy/market-selector.test.ts --no-coverage
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types/config.ts src/strategy/config.ts src/strategy/market-selector.ts tests/strategy/market-selector.test.ts
git commit -m "fix(markets): reject pathological books for small live"
```

---

## Task 6: Add Small-Live Metrics and Telegram Report Formatting

**Files:**
- Create: `src/monitoring/small-live-metrics.ts`
- Create: `tests/monitoring/small-live-metrics.test.ts`
- Create: `src/reporting/small-live-telegram-report.ts`
- Create: `tests/reporting/small-live-telegram-report.test.ts`

- [ ] **Step 1: Write metrics tests**

Create `tests/monitoring/small-live-metrics.test.ts`:

```ts
import { SmallLiveMetrics } from '../../src/monitoring/small-live-metrics';

test('tracks and resets 3h window counters', () => {
  const metrics = new SmallLiveMetrics();

  metrics.recordSubmit('live');
  metrics.recordSubmit('matched');
  metrics.recordReject('balance');
  metrics.recordAlert('low_balance');
  metrics.recordCycleLag(7000);

  expect(metrics.snapshot()).toEqual({
    liveSubmits: 1,
    matchedSubmits: 1,
    rejects: { balance: 1 },
    alerts: { low_balance: 1 },
    maxCycleLagMs: 7000,
  });

  expect(metrics.reset()).toEqual({
    liveSubmits: 1,
    matchedSubmits: 1,
    rejects: { balance: 1 },
    alerts: { low_balance: 1 },
    maxCycleLagMs: 7000,
  });
  expect(metrics.snapshot().liveSubmits).toBe(0);
});
```

- [ ] **Step 2: Write report formatting tests**

Create `tests/reporting/small-live-telegram-report.test.ts`:

```ts
import { formatSmallLiveTelegramReport, formatSmallLiveAlert } from '../../src/reporting/small-live-telegram-report';

test('formats compact 3h small_live report', () => {
  const text = formatSmallLiveTelegramReport({
    mode: 'shadow',
    reportAt: new Date('2026-05-31T09:00:00Z'),
    balanceUsd: 15.48,
    openOrdersCount: 0,
    openOrdersNotionalUsd: 0,
    positionsCount: 0,
    positionsValueUsd: 0,
    realizedPnlUsd: 0,
    unrealizedPnlUsd: 0,
    fillsCount: 2,
    rejectsCount: 1,
    activeMarkets: 1,
    riskState: 'OK',
  });

  expect(text).toContain('Small Live Report');
  expect(text).toContain('Mode: shadow');
  expect(text).toContain('Balance: $15.48');
  expect(text).toContain('Fills 3h: 2');
  expect(text).toContain('Rejects 3h: 1');
});

test('formats critical alert', () => {
  const text = formatSmallLiveAlert({ severity: 'CRITICAL', title: 'Open order leak', detail: '43 open orders detected' });

  expect(text).toContain('CRITICAL');
  expect(text).toContain('Open order leak');
  expect(text).toContain('43 open orders detected');
});
```

- [ ] **Step 3: Run tests to verify fail**

```bash
npx jest tests/monitoring/small-live-metrics.test.ts tests/reporting/small-live-telegram-report.test.ts --no-coverage
```

Expected: FAIL because modules do not exist.

- [ ] **Step 4: Implement metrics class**

Create `src/monitoring/small-live-metrics.ts`:

```ts
export interface SmallLiveMetricsSnapshot {
  liveSubmits: number;
  matchedSubmits: number;
  rejects: Record<string, number>;
  alerts: Record<string, number>;
  maxCycleLagMs: number;
}

export class SmallLiveMetrics {
  private data: SmallLiveMetricsSnapshot = {
    liveSubmits: 0,
    matchedSubmits: 0,
    rejects: {},
    alerts: {},
    maxCycleLagMs: 0,
  };

  recordSubmit(status: 'live' | 'matched'): void {
    if (status === 'live') this.data.liveSubmits += 1;
    if (status === 'matched') this.data.matchedSubmits += 1;
  }

  recordReject(reason: string): void {
    this.data.rejects[reason] = (this.data.rejects[reason] ?? 0) + 1;
  }

  recordAlert(reason: string): void {
    this.data.alerts[reason] = (this.data.alerts[reason] ?? 0) + 1;
  }

  recordCycleLag(ms: number): void {
    this.data.maxCycleLagMs = Math.max(this.data.maxCycleLagMs, ms);
  }

  snapshot(): SmallLiveMetricsSnapshot {
    return {
      liveSubmits: this.data.liveSubmits,
      matchedSubmits: this.data.matchedSubmits,
      rejects: { ...this.data.rejects },
      alerts: { ...this.data.alerts },
      maxCycleLagMs: this.data.maxCycleLagMs,
    };
  }

  reset(): SmallLiveMetricsSnapshot {
    const snap = this.snapshot();
    this.data = { liveSubmits: 0, matchedSubmits: 0, rejects: {}, alerts: {}, maxCycleLagMs: 0 };
    return snap;
  }
}
```

- [ ] **Step 5: Implement report formatter**

Create `src/reporting/small-live-telegram-report.ts`:

```ts
export interface SmallLiveTelegramReportInput {
  mode: string;
  reportAt: Date;
  balanceUsd: number;
  openOrdersCount: number;
  openOrdersNotionalUsd: number;
  positionsCount: number;
  positionsValueUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  fillsCount: number;
  rejectsCount: number;
  activeMarkets: number;
  riskState: 'OK' | 'WARN' | 'STOP';
}

export interface SmallLiveAlertInput {
  severity: 'INFO' | 'WARN' | 'CRITICAL';
  title: string;
  detail: string;
}

function usd(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function formatSmallLiveTelegramReport(input: SmallLiveTelegramReportInput): string {
  return [
    `📊 <b>Small Live Report</b> — ${input.reportAt.toISOString()}`,
    `Mode: ${input.mode}`,
    `Balance: ${usd(input.balanceUsd)}`,
    `Open orders: ${input.openOrdersCount} / ${usd(input.openOrdersNotionalUsd)}`,
    `Positions: ${input.positionsCount} / ${usd(input.positionsValueUsd)}`,
    `PnL: realized ${usd(input.realizedPnlUsd)} / unrealized ${usd(input.unrealizedPnlUsd)}`,
    `Fills 3h: ${input.fillsCount}`,
    `Rejects 3h: ${input.rejectsCount}`,
    `Active markets: ${input.activeMarkets}`,
    `Risk state: ${input.riskState}`,
  ].join('\n');
}

export function formatSmallLiveAlert(input: SmallLiveAlertInput): string {
  return [
    `🚨 <b>${input.severity}</b> — ${input.title}`,
    input.detail,
  ].join('\n');
}
```

- [ ] **Step 6: Run tests to verify pass**

```bash
npx jest tests/monitoring/small-live-metrics.test.ts tests/reporting/small-live-telegram-report.test.ts --no-coverage
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/monitoring/small-live-metrics.ts tests/monitoring/small-live-metrics.test.ts src/reporting/small-live-telegram-report.ts tests/reporting/small-live-telegram-report.test.ts
git commit -m "feat(monitoring): add small live metrics and Telegram reports"
```

---

## Task 7: Wire Runtime Snapshot, Alerts, and 3-Hour Reports in Shadow-Safe Mode

**Files:**
- Modify: `src/run-small-live.ts`
- Modify: `src/strategy/small-live-runner.ts`
- Test: `tests/strategy/small-live-runner.test.ts`

- [ ] **Step 1: Add test for report interval wiring**

In `tests/strategy/small-live-runner.test.ts`, add a pure helper test after creating helper functions in Step 3:

```ts
import { shouldSendSmallLiveReport } from '../../src/strategy/small-live-runner';

test('sends 3h report when interval elapsed', () => {
  const last = new Date('2026-05-31T00:00:00Z').getTime();
  const now = new Date('2026-05-31T03:00:01Z').getTime();

  expect(shouldSendSmallLiveReport(last, now, 3)).toBe(true);
  expect(shouldSendSmallLiveReport(last, now, 4)).toBe(false);
});
```

- [ ] **Step 2: Run test to verify fail**

```bash
npx jest tests/strategy/small-live-runner.test.ts --no-coverage
```

Expected: FAIL because `shouldSendSmallLiveReport` does not exist.

- [ ] **Step 3: Add pure report interval helper**

In `src/strategy/small-live-runner.ts`, export:

```ts
export function shouldSendSmallLiveReport(lastReportAtMs: number, nowMs: number, intervalHours: number): boolean {
  return nowMs - lastReportAtMs >= intervalHours * 60 * 60 * 1000;
}
```

- [ ] **Step 4: Wire report scheduler in `run-small-live.ts`**

In `src/run-small-live.ts`, import:

```ts
import { SmallLiveMetrics } from './monitoring/small-live-metrics';
import { formatSmallLiveTelegramReport, formatSmallLiveAlert } from './reporting/small-live-telegram-report';
```

After Telegram notifier creation, instantiate metrics:

```ts
const telegram = new TelegramNotifier({ botToken: env.telegramBotToken ?? '', chatId: env.telegramChatId ?? '' });
const metrics = new SmallLiveMetrics();
let lastReportAtMs = Date.now();
```

Inside `runOneCycle`, after `await runner.runCycle(...)`, add report sending:

```ts
const now = Date.now();
if (shouldSendSmallLiveReport(lastReportAtMs, now, env.telegramReportIntervalHours)) {
  const snap = metrics.reset();
  await telegram.sendMessage(formatSmallLiveTelegramReport({
    mode: config.mode,
    reportAt: new Date(now),
    balanceUsd: runner.getInventory().getPusdAvailable(),
    openOrdersCount: 0,
    openOrdersNotionalUsd: 0,
    positionsCount: 0,
    positionsValueUsd: runner.getInventory().getTotalExposureUsd(),
    realizedPnlUsd: 0,
    unrealizedPnlUsd: 0,
    fillsCount: snap.matchedSubmits,
    rejectsCount: Object.values(snap.rejects).reduce((sum, value) => sum + value, 0),
    activeMarkets: env.maxMarkets,
    riskState: 'OK',
  }));
  lastReportAtMs = now;
}
```

This first wiring intentionally uses internal inventory values only; CLOB snapshot integration is Task 8.

- [ ] **Step 5: Send startup alert in shadow and live**

After startup config logging in `run-small-live.ts`, add:

```ts
await telegram.sendMessage(formatSmallLiveAlert({
  severity: config.mode === 'small_live' && config.liveTradingEnabled ? 'CRITICAL' : 'INFO',
  title: 'Bot started',
  detail: `Mode=${config.mode}, liveTradingEnabled=${config.liveTradingEnabled}, maxMarkets=${env.maxMarkets}`,
}));
```

- [ ] **Step 6: Run tests and build**

```bash
npx jest tests/strategy/small-live-runner.test.ts tests/reporting/small-live-telegram-report.test.ts tests/monitoring/small-live-metrics.test.ts --no-coverage
npm run build
```

Expected: PASS and build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/run-small-live.ts src/strategy/small-live-runner.ts tests/strategy/small-live-runner.test.ts
git commit -m "feat(live): wire small live Telegram reports"
```

---

## Task 8: Add CLOB Snapshot Collection and Runtime Stop-New-Orders Guard

**Files:**
- Modify: `src/strategy/small-live-runner.ts`
- Modify: `src/run-small-live.ts`
- Modify: `tests/strategy/small-live-runner.test.ts`

- [ ] **Step 1: Add test for open order notional helper**

In `tests/strategy/small-live-runner.test.ts`, import and test:

```ts
import { calculateOpenOrderNotionalUsd } from '../../src/strategy/small-live-runner';

test('calculates remaining open order notional', () => {
  expect(calculateOpenOrderNotionalUsd([
    { price: '0.25', original_size: '10', size_matched: '4' },
    { price: '0.50', original_size: '5', size_matched: '0' },
  ])).toBeCloseTo(4.0);
});
```

- [ ] **Step 2: Run test to verify fail**

```bash
npx jest tests/strategy/small-live-runner.test.ts --no-coverage
```

Expected: FAIL because helper does not exist.

- [ ] **Step 3: Implement helper**

In `src/strategy/small-live-runner.ts`, export:

```ts
export function calculateOpenOrderNotionalUsd(openOrders: any[]): number {
  return openOrders.reduce((sum, order) => {
    const price = Number(order.price ?? 0);
    const original = Number(order.original_size ?? order.size ?? 0);
    const matched = Number(order.size_matched ?? 0);
    return sum + price * Math.max(0, original - matched);
  }, 0);
}
```

- [ ] **Step 4: Add runtime snapshot before each live cycle**

In `run-small-live.ts`, before `await runner.runCycle(...)`, add:

```ts
const openOrders = await liveSubmitter.getOpenOrders();
const openOrderNotionalUsd = calculateOpenOrderNotionalUsd(openOrders);
if (config.mode === 'small_live' && config.liveTradingEnabled && openOrderNotionalUsd > env.maxExposureUsd) {
  await telegram.sendMessage(formatSmallLiveAlert({
    severity: 'CRITICAL',
    title: 'Open order exposure above limit',
    detail: `openOrderNotionalUsd=${openOrderNotionalUsd.toFixed(2)}, maxExposureUsd=${env.maxExposureUsd}`,
  }));
  return;
}
```

This is intentionally conservative: skip the cycle instead of submitting more orders.

- [ ] **Step 5: Run tests and build**

```bash
npx jest tests/strategy/small-live-runner.test.ts --no-coverage
npm run build
```

Expected: PASS and build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/strategy/small-live-runner.ts src/run-small-live.ts tests/strategy/small-live-runner.test.ts
git commit -m "fix(live): guard runtime against open order exposure leaks"
```

---

## Task 9: Shadow Deployment Verification

**Files:**
- No code changes unless verification finds failures.
- Server: `/home/ubuntu/polymarketmm/.env`

- [ ] **Step 1: Push all commits**

```bash
git push origin main
```

Expected: push succeeds.

- [ ] **Step 2: Deploy in shadow mode only**

```bash
ssh -i ~/.ssh/polymarket-mm-key.pem ubuntu@54.154.79.239
cd /home/ubuntu/polymarketmm
git pull
sed -i 's/^MODE=.*/MODE=shadow/; s/^LIVE_TRADING_ENABLED=.*/LIVE_TRADING_ENABLED=false/; s/^MAX_MARKETS=.*/MAX_MARKETS=1/; s/^MAX_EXPOSURE_USD=.*/MAX_EXPOSURE_USD=10/' .env
docker compose down
docker compose up --build -d
```

Expected: container starts in shadow/safe mode.

- [ ] **Step 3: Verify no live submits in shadow**

```bash
sleep 120
docker compose logs --tail=500 polymarket-bot | grep -E 'SUBMIT_START|SUBMIT_RESULT|createAndPostOrder' || true
```

Expected: no output. Any submit output in shadow is a blocker.

- [ ] **Step 4: Verify account remains clean**

Run the read-only CLOB diagnostic from the approved session:

```bash
docker compose run --rm --entrypoint node polymarket-bot - <<'NODE'
require('dotenv/config');
const { ClobClient, Chain, AssetType } = require('@polymarket/clob-client-v2');
const { createWalletClient, http } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { polygon } = require('viem/chains');
async function main() {
  const account = privateKeyToAccount(process.env.PRIVATE_KEY);
  const walletClient = createWalletClient({ account, chain: polygon, transport: http() });
  const client = new ClobClient({
    host: 'https://clob.polymarket.com', chain: Chain.POLYGON, signer: walletClient,
    creds: { key: process.env.CLOB_API_KEY, secret: process.env.CLOB_API_SECRET, passphrase: process.env.CLOB_API_PASSPHRASE },
    signatureType: 3, funderAddress: process.env.WALLET_ADDRESS,
  });
  const orders = await client.getOpenOrders();
  const arr = Array.isArray(orders) ? orders : (orders.orders || orders.data || []);
  const bal = await client.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
  const positionsRes = await fetch('https://data-api.polymarket.com/positions?user=' + process.env.WALLET_ADDRESS);
  const positions = await positionsRes.json();
  console.log(JSON.stringify({ openOrders: arr.length, balanceUsd: Number(bal.balance) / 1e6, positions: positions.length }));
}
main().catch(e=>{ console.error(e); process.exit(1); });
NODE
```

Expected:

```json
{"openOrders":0,"balanceUsd":15.481611,"positions":0}
```

The exact balance may differ if the user deposits or withdraws; open orders must be 0 during shadow.

- [ ] **Step 5: Verify Telegram startup/report messages**

Expected:

- Telegram receives startup message with `Mode=shadow` and `liveTradingEnabled=false`.
- Telegram receives a report when interval is manually shortened or after 3 hours in normal mode.

- [ ] **Step 6: Commit deployment notes if any config docs changed**

If deployment instructions are updated, commit them:

```bash
git add docs/superpowers/specs docs/superpowers/plans README.md .env.example
git commit -m "docs: record shadow deployment verification" || true
```

---

## Task 10: Controlled Live Go/No-Go Checklist

**Files:**
- Create: `docs/superpowers/specs/2026-05-31-small-live-go-no-go.md`

- [ ] **Step 1: Write checklist file**

Create `docs/superpowers/specs/2026-05-31-small-live-go-no-go.md`:

```md
# Small Live Go/No-Go Checklist

## Required Before Live

- [ ] Production `.env` has `MODE=shadow` during review.
- [ ] `LIVE_TRADING_ENABLED=false` during review.
- [ ] Open orders = 0.
- [ ] Positions reconcile with Data API.
- [ ] CLOB collateral balance is recorded.
- [ ] Telegram startup alert received.
- [ ] Telegram 3-hour report formatting verified.
- [ ] Shadow ran at least 30 minutes with no `SUBMIT_START` or `SUBMIT_RESULT`.
- [ ] No repeated CLOB/Data API errors in shadow logs.
- [ ] User explicitly approves live switch.

## Live Settings For First Run

```env
MODE=small_live
LIVE_TRADING_ENABLED=true
MAX_MARKETS=1
MAX_EXPOSURE_USD=10
TELEGRAM_REPORT_INTERVAL_HOURS=3
```

## First 10 Minutes Live

- [ ] Observe logs continuously.
- [ ] Confirm open order count stays within expected slots.
- [ ] Confirm no repeated balance/allowance rejects.
- [ ] Confirm inventory changes after any matched response.
- [ ] Confirm Telegram alert/report path remains healthy.

## Stop Conditions

- Any open order leak.
- Any inventory mismatch.
- Three balance/allowance rejects in a report window.
- WebSocket disconnect beyond configured threshold.
- User requests stop.
```

- [ ] **Step 2: Commit checklist**

```bash
git add docs/superpowers/specs/2026-05-31-small-live-go-no-go.md
git commit -m "docs: add small live go no-go checklist"
```

---

## Final Verification Commands

Run before claiming complete:

```bash
npm run build
npx jest tests/risk/live-account-risk.test.ts tests/strategy/small-live-preflight.test.ts tests/execution/execution-modules.test.ts tests/strategy/strategy-runner.test.ts tests/strategy/market-selector.test.ts tests/monitoring/small-live-metrics.test.ts tests/reporting/small-live-telegram-report.test.ts tests/invariants/runtime.test.ts --no-coverage
ssh -i ~/.ssh/polymarket-mm-key.pem ubuntu@54.154.79.239 'cd /home/ubuntu/polymarketmm && docker compose ps && grep -E "^(MODE|LIVE_TRADING_ENABLED|MAX_MARKETS|MAX_EXPOSURE_USD|TELEGRAM_REPORT_INTERVAL_HOURS)=" .env'
```

Expected:

- Build passes.
- Listed Jest suites pass.
- Production remains safe until explicit live approval.

## Self-Review Against Spec

- Safety gate: Tasks 1, 2, 3, 8, 10.
- Inventory/order accounting: Tasks 4 and 8.
- Profitability/pathological market filters: Task 5.
- Telegram immediate alerts and 3-hour reports: Tasks 6 and 7.
- Shadow-first deployment: Tasks 9 and 10.
- Official docs usage: reflected in design and implementation constraints; no code should rely on undocumented assumptions without tests.

No implementation task is allowed to switch production back to live without the go/no-go checklist and explicit user approval.
