# Strategy Risk Layer and Telegram Risk Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add live-ready risk controls to paper strategy and replace the misleading Telegram PnL summary with a risk-oriented production report.

**Architecture:** Add focused modules for activity tracking, strategy risk decisions, and Telegram report formatting. Wire them into `src/run-paper.ts` so paper-mode gates quotes through the same risk layer intended for future live-mode, while live remains disabled.

**Tech Stack:** TypeScript, Jest, Node.js, existing `PaperPnlTracker`, `PaperExecutionEngine`, Telegram notifier, and console JSON logger.

---

## File Map

- Create `src/accounting/trading-activity-tracker.ts` — counts fills, quote decisions, notional, contracts, active markets, and primary-market concentration.
- Create `tests/accounting/trading-activity-tracker.test.ts` — unit tests for activity counting.
- Create `src/risk/strategy-risk-manager.ts` — computes inventory risk, reduce-only gates, exit valuation, worst-case loss, and risk status.
- Create `tests/risk/strategy-risk-manager.test.ts` — unit tests for quote gating and risk calculations.
- Create `src/reporting/telegram-risk-report.ts` — formats a Telegram HTML risk report.
- Create `tests/reporting/telegram-risk-report.test.ts` — unit tests for report content and labels.
- Modify `src/accounting/paper-pnl-tracker.ts` — expose cumulative realized PnL and totals needed by report.
- Modify `tests/accounting/paper-pnl-tracker.test.ts` if present, otherwise add coverage inside new reporting/risk tests only.
- Modify `src/run-paper.ts` — instantiate trackers, record activity, gate quotes, and send new report.
- Modify `src/strategy/config.ts` only if current inventory limit semantics are insufficient after Task 2. Prefer existing config first.

---

## Task 1: Trading Activity Tracker

**Files:**
- Create: `src/accounting/trading-activity-tracker.ts`
- Create: `tests/accounting/trading-activity-tracker.test.ts`

- [ ] **Step 1: Write failing tests for fill and quote activity**

Create `tests/accounting/trading-activity-tracker.test.ts`:

```ts
import { TradingActivityTracker } from '../../src/accounting/trading-activity-tracker';
import { FillEvent } from '../../src/simulation/paper-execution-engine';

describe('TradingActivityTracker', () => {
  const buyFill: FillEvent = {
    orderId: 'order-1',
    tokenId: 'token-yes',
    side: 'BUY',
    filledPrice: 0.54,
    filledSize: 2,
    remainingSize: 0,
  };

  const sellFill: FillEvent = {
    orderId: 'order-2',
    tokenId: 'token-yes',
    side: 'SELL',
    filledPrice: 0.62,
    filledSize: 3,
    remainingSize: 0,
  };

  test('counts fills, contracts, notional, and average fill price', () => {
    const tracker = new TradingActivityTracker();

    tracker.recordFill('market-1', buyFill);
    tracker.recordFill('market-1', sellFill);

    const snapshot = tracker.snapshot();

    expect(snapshot.fillsTotal).toBe(2);
    expect(snapshot.buyFills).toBe(1);
    expect(snapshot.sellFills).toBe(1);
    expect(snapshot.buyContracts).toBe(2);
    expect(snapshot.sellContracts).toBe(3);
    expect(snapshot.totalContracts).toBe(5);
    expect(snapshot.buyNotional).toBeCloseTo(1.08);
    expect(snapshot.sellNotional).toBeCloseTo(1.86);
    expect(snapshot.notionalVolume).toBeCloseTo(2.94);
    expect(snapshot.avgFillPrice).toBeCloseTo(2.94 / 5);
    expect(snapshot.activeMarkets).toBe(1);
  });

  test('counts quote traces and primary market concentration', () => {
    const tracker = new TradingActivityTracker();

    tracker.recordQuoteGenerated('market-1');
    tracker.recordQuoteGenerated('market-1');
    tracker.recordQuoteGenerated('market-2');
    tracker.recordQuoteRejected('market-1');

    const snapshot = tracker.snapshot();

    expect(snapshot.quoteTraces).toBe(4);
    expect(snapshot.quoteGeneratedCount).toBe(3);
    expect(snapshot.quoteRejectedCount).toBe(1);
    expect(snapshot.activeMarkets).toBe(2);
    expect(snapshot.primaryMarketConditionId).toBe('market-1');
    expect(snapshot.primaryMarketQuoteTraces).toBe(3);
    expect(snapshot.primaryMarketQuoteSharePct).toBeCloseTo(75);
  });

  test('returns null averages and primary market when empty', () => {
    const tracker = new TradingActivityTracker();

    const snapshot = tracker.snapshot();

    expect(snapshot.fillsTotal).toBe(0);
    expect(snapshot.avgFillPrice).toBeNull();
    expect(snapshot.primaryMarketConditionId).toBeNull();
    expect(snapshot.primaryMarketQuoteSharePct).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx jest tests/accounting/trading-activity-tracker.test.ts
```

Expected: FAIL because `src/accounting/trading-activity-tracker.ts` does not exist.

- [ ] **Step 3: Implement `TradingActivityTracker`**

Create `src/accounting/trading-activity-tracker.ts`:

```ts
import { FillEvent } from '../simulation/paper-execution-engine';

export interface TradingActivitySnapshot {
  fillsTotal: number;
  buyFills: number;
  sellFills: number;
  buyContracts: number;
  sellContracts: number;
  totalContracts: number;
  buyNotional: number;
  sellNotional: number;
  notionalVolume: number;
  avgFillPrice: number | null;
  quoteTraces: number;
  quoteGeneratedCount: number;
  quoteRejectedCount: number;
  activeMarkets: number;
  primaryMarketConditionId: string | null;
  primaryMarketQuoteTraces: number;
  primaryMarketQuoteSharePct: number | null;
}

export class TradingActivityTracker {
  private fillsTotal = 0;
  private buyFills = 0;
  private sellFills = 0;
  private buyContracts = 0;
  private sellContracts = 0;
  private buyNotional = 0;
  private sellNotional = 0;
  private quoteGeneratedCount = 0;
  private quoteRejectedCount = 0;
  private marketActivity = new Map<string, { fills: number; quoteTraces: number }>();

  recordFill(conditionId: string, fill: FillEvent): void {
    const notional = fill.filledPrice * fill.filledSize;
    this.fillsTotal += 1;

    if (fill.side === 'BUY') {
      this.buyFills += 1;
      this.buyContracts += fill.filledSize;
      this.buyNotional += notional;
    } else {
      this.sellFills += 1;
      this.sellContracts += fill.filledSize;
      this.sellNotional += notional;
    }

    this.getMarketActivity(conditionId).fills += 1;
  }

  recordQuoteGenerated(conditionId: string): void {
    this.quoteGeneratedCount += 1;
    this.getMarketActivity(conditionId).quoteTraces += 1;
  }

  recordQuoteRejected(conditionId: string): void {
    this.quoteRejectedCount += 1;
    this.getMarketActivity(conditionId).quoteTraces += 1;
  }

  snapshot(): TradingActivitySnapshot {
    const totalContracts = this.buyContracts + this.sellContracts;
    const notionalVolume = this.buyNotional + this.sellNotional;
    const quoteTraces = this.quoteGeneratedCount + this.quoteRejectedCount;
    const primary = this.getPrimaryMarket();

    return {
      fillsTotal: this.fillsTotal,
      buyFills: this.buyFills,
      sellFills: this.sellFills,
      buyContracts: this.buyContracts,
      sellContracts: this.sellContracts,
      totalContracts,
      buyNotional: this.buyNotional,
      sellNotional: this.sellNotional,
      notionalVolume,
      avgFillPrice: totalContracts > 0 ? notionalVolume / totalContracts : null,
      quoteTraces,
      quoteGeneratedCount: this.quoteGeneratedCount,
      quoteRejectedCount: this.quoteRejectedCount,
      activeMarkets: this.marketActivity.size,
      primaryMarketConditionId: primary?.conditionId ?? null,
      primaryMarketQuoteTraces: primary?.quoteTraces ?? 0,
      primaryMarketQuoteSharePct: primary && quoteTraces > 0 ? (primary.quoteTraces / quoteTraces) * 100 : null,
    };
  }

  private getMarketActivity(conditionId: string): { fills: number; quoteTraces: number } {
    const existing = this.marketActivity.get(conditionId);
    if (existing) return existing;
    const created = { fills: 0, quoteTraces: 0 };
    this.marketActivity.set(conditionId, created);
    return created;
  }

  private getPrimaryMarket(): { conditionId: string; quoteTraces: number } | null {
    let best: { conditionId: string; quoteTraces: number } | null = null;
    for (const [conditionId, activity] of this.marketActivity) {
      if (!best || activity.quoteTraces > best.quoteTraces) {
        best = { conditionId, quoteTraces: activity.quoteTraces };
      }
    }
    return best;
  }
}
```

- [ ] **Step 4: Run test and verify it passes**

Run:

```bash
npx jest tests/accounting/trading-activity-tracker.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/accounting/trading-activity-tracker.ts tests/accounting/trading-activity-tracker.test.ts
git commit -m "feat(accounting): track trading activity metrics"
```

---

## Task 2: Paper PnL Cumulative Accessors

**Files:**
- Modify: `src/accounting/paper-pnl-tracker.ts`
- Create if missing: `tests/accounting/paper-pnl-tracker.test.ts`

- [ ] **Step 1: Check for existing test file**

Run:

```bash
ls tests/accounting
```

If `tests/accounting/paper-pnl-tracker.test.ts` exists, append the test below. If it does not exist, create it.

- [ ] **Step 2: Write failing test for cumulative realized PnL**

Add to `tests/accounting/paper-pnl-tracker.test.ts`:

```ts
import { PaperPnlTracker } from '../../src/accounting/paper-pnl-tracker';

describe('PaperPnlTracker cumulative totals', () => {
  test('exposes cumulative realized pnl across all positions', () => {
    const tracker = new PaperPnlTracker();

    tracker.onFill({ orderId: 'buy-1', tokenId: 'token-1', side: 'BUY', filledPrice: 0.50, filledSize: 10, remainingSize: 0 }, 0.50);
    tracker.onFill({ orderId: 'sell-1', tokenId: 'token-1', side: 'SELL', filledPrice: 0.60, filledSize: 4, remainingSize: 0 }, 0.60);

    expect(tracker.getCumulativeRealizedPnl()).toBeCloseTo(0.40);
  });

  test('exposes open position count', () => {
    const tracker = new PaperPnlTracker();

    tracker.onFill({ orderId: 'buy-1', tokenId: 'token-1', side: 'BUY', filledPrice: 0.50, filledSize: 10, remainingSize: 0 }, 0.50);
    tracker.onFill({ orderId: 'buy-2', tokenId: 'token-2', side: 'BUY', filledPrice: 0.30, filledSize: 5, remainingSize: 0 }, 0.30);
    tracker.onFill({ orderId: 'sell-1', tokenId: 'token-2', side: 'SELL', filledPrice: 0.31, filledSize: 5, remainingSize: 0 }, 0.31);

    expect(tracker.getOpenPositionCount()).toBe(1);
  });
});
```

If the file already imports `PaperPnlTracker`, do not duplicate the import; merge the `describe` block.

- [ ] **Step 3: Run test to verify it fails**

Run:

```bash
npx jest tests/accounting/paper-pnl-tracker.test.ts
```

Expected: FAIL because `getCumulativeRealizedPnl` and `getOpenPositionCount` do not exist.

- [ ] **Step 4: Implement accessors**

Modify `src/accounting/paper-pnl-tracker.ts` by adding these methods inside `PaperPnlTracker`, after `getAllPositions()`:

```ts
  getCumulativeRealizedPnl(): number {
    return this.getAllPositions().reduce((sum, pos) => sum + pos.realizedPnl, 0);
  }

  getOpenPositionCount(): number {
    return this.getAllPositions().filter(pos => pos.netSize !== 0).length;
  }
```

- [ ] **Step 5: Run tests**

Run:

```bash
npx jest tests/accounting/paper-pnl-tracker.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/accounting/paper-pnl-tracker.ts tests/accounting/paper-pnl-tracker.test.ts
git commit -m "feat(accounting): expose cumulative paper pnl"
```

---

## Task 3: Strategy Risk Manager

**Files:**
- Create: `src/risk/strategy-risk-manager.ts`
- Create: `tests/risk/strategy-risk-manager.test.ts`

- [ ] **Step 1: Write failing risk manager tests**

Create `tests/risk/strategy-risk-manager.test.ts`:

```ts
import { StrategyRiskManager, StrategyRiskConfig } from '../../src/risk/strategy-risk-manager';
import { Position } from '../../src/accounting/paper-pnl-tracker';
import { BookState } from '../../src/types/book';

const config: StrategyRiskConfig = {
  softInventoryLimitPct: 50,
  reduceOnlyInventoryLimitPct: 70,
  hardInventoryLimitPct: 90,
  maxMarketExposureContracts: 100,
  concentrationWarningPct: 90,
  concentrationCriticalPctLive: 90,
};

function makePosition(overrides: Partial<Position>): Position {
  return {
    tokenId: 'token-yes',
    netSize: 0,
    avgCost: 0,
    realizedPnl: 0,
    totalBoughtUsd: 0,
    totalSoldUsd: 0,
    totalVolumeUsd: 0,
    ...overrides,
  };
}

function makeBook(overrides: Partial<BookState> = {}): BookState {
  return {
    conditionId: 'market-1',
    tokenId: 'token-yes',
    bestBid: 0.55,
    bestAsk: 0.56,
    bestBidSizeUsd: 100,
    bestAskSizeUsd: 100,
    midpoint: 0.555,
    spreadTicks: 1,
    tickSize: 0.01,
    bids: [{ price: 0.55, size: 100 }],
    asks: [{ price: 0.56, size: 100 }],
    lastUpdateMs: Date.now(),
    minOrderSize: 1,
    ...overrides,
  };
}

describe('StrategyRiskManager', () => {
  test('blocks SELL and allows BUY when short above reduce-only threshold', () => {
    const manager = new StrategyRiskManager(config);

    const decision = manager.evaluateMarket({
      mode: 'paper',
      conditionId: 'market-1',
      tokenId: 'token-yes',
      position: makePosition({ netSize: -80, avgCost: 0.62 }),
      book: makeBook(),
      currentFair: 0.555,
      primaryMarketQuoteSharePct: 50,
      hasActiveQuotes: true,
      isBookStale: false,
      killSwitchActive: false,
    });

    expect(decision.reduceOnly).toBe(true);
    expect(decision.allowBuy).toBe(true);
    expect(decision.allowSell).toBe(false);
    expect(decision.positionSide).toBe('SHORT');
    expect(decision.inventoryUsagePct).toBeCloseTo(80);
    expect(decision.reasons).toContain('reduce_only_short_inventory');
  });

  test('blocks BUY and allows SELL when long above reduce-only threshold', () => {
    const manager = new StrategyRiskManager(config);

    const decision = manager.evaluateMarket({
      mode: 'paper',
      conditionId: 'market-1',
      tokenId: 'token-yes',
      position: makePosition({ netSize: 75, avgCost: 0.40 }),
      book: makeBook(),
      currentFair: 0.45,
      primaryMarketQuoteSharePct: 50,
      hasActiveQuotes: true,
      isBookStale: false,
      killSwitchActive: false,
    });

    expect(decision.reduceOnly).toBe(true);
    expect(decision.allowBuy).toBe(false);
    expect(decision.allowSell).toBe(true);
    expect(decision.positionSide).toBe('LONG');
    expect(decision.reasons).toContain('reduce_only_long_inventory');
  });

  test('allows both sides below soft threshold', () => {
    const manager = new StrategyRiskManager(config);

    const decision = manager.evaluateMarket({
      mode: 'paper',
      conditionId: 'market-1',
      tokenId: 'token-yes',
      position: makePosition({ netSize: 20, avgCost: 0.40 }),
      book: makeBook(),
      currentFair: 0.45,
      primaryMarketQuoteSharePct: 50,
      hasActiveQuotes: true,
      isBookStale: false,
      killSwitchActive: false,
    });

    expect(decision.reduceOnly).toBe(false);
    expect(decision.allowBuy).toBe(true);
    expect(decision.allowSell).toBe(true);
    expect(decision.riskStatus).toBe('OK');
  });

  test('computes short fair pnl, exit pnl, and worst case to one', () => {
    const manager = new StrategyRiskManager(config);

    const decision = manager.evaluateMarket({
      mode: 'paper',
      conditionId: 'market-1',
      tokenId: 'token-yes',
      position: makePosition({ netSize: -10, avgCost: 0.62 }),
      book: makeBook({ bestAsk: 0.57 }),
      currentFair: 0.55,
      primaryMarketQuoteSharePct: 50,
      hasActiveQuotes: true,
      isBookStale: false,
      killSwitchActive: false,
    });

    expect(decision.fairUnrealizedPnl).toBeCloseTo(0.70);
    expect(decision.exitPnlAtBestBidAsk).toBeCloseTo(0.50);
    expect(decision.worstCaseLossToOne).toBeCloseTo(3.80);
    expect(decision.worstCaseLossToZero).toBeNull();
  });

  test('escalates concentration above warning threshold', () => {
    const manager = new StrategyRiskManager(config);

    const decision = manager.evaluateMarket({
      mode: 'paper',
      conditionId: 'market-1',
      tokenId: 'token-yes',
      position: makePosition({ netSize: 10, avgCost: 0.40 }),
      book: makeBook(),
      currentFair: 0.45,
      primaryMarketQuoteSharePct: 99.95,
      hasActiveQuotes: true,
      isBookStale: false,
      killSwitchActive: false,
    });

    expect(decision.riskStatus).toBe('WARNING');
    expect(decision.reasons).toContain('single_market_concentration_above_90_pct');
  });

  test('escalates hard inventory breach to critical', () => {
    const manager = new StrategyRiskManager(config);

    const decision = manager.evaluateMarket({
      mode: 'paper',
      conditionId: 'market-1',
      tokenId: 'token-yes',
      position: makePosition({ netSize: -95, avgCost: 0.62 }),
      book: makeBook(),
      currentFair: 0.55,
      primaryMarketQuoteSharePct: 50,
      hasActiveQuotes: true,
      isBookStale: false,
      killSwitchActive: false,
    });

    expect(decision.riskStatus).toBe('CRITICAL');
    expect(decision.reasons).toContain('inventory_limit_above_90_pct');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx jest tests/risk/strategy-risk-manager.test.ts
```

Expected: FAIL because `src/risk/strategy-risk-manager.ts` does not exist.

- [ ] **Step 3: Implement risk manager**

Create `src/risk/strategy-risk-manager.ts`:

```ts
import { Position } from '../accounting/paper-pnl-tracker';
import { BookState } from '../types/book';

export type RiskStatus = 'OK' | 'WATCH' | 'WARNING' | 'CRITICAL';
export type PositionSide = 'LONG' | 'SHORT' | 'FLAT';
export type StrategyMode = 'paper' | 'shadow' | 'small_live' | 'disabled';

export interface StrategyRiskConfig {
  softInventoryLimitPct: number;
  reduceOnlyInventoryLimitPct: number;
  hardInventoryLimitPct: number;
  maxMarketExposureContracts: number;
  concentrationWarningPct: number;
  concentrationCriticalPctLive: number;
}

export interface StrategyRiskInput {
  mode: StrategyMode;
  conditionId: string;
  tokenId: string;
  position: Position | undefined;
  book: BookState | undefined;
  currentFair: number | null;
  primaryMarketQuoteSharePct: number | null;
  hasActiveQuotes: boolean;
  isBookStale: boolean;
  killSwitchActive: boolean;
}

export interface MarketRiskDecision {
  conditionId: string;
  tokenId: string;
  riskStatus: RiskStatus;
  reasons: string[];
  reduceOnly: boolean;
  allowBuy: boolean;
  allowSell: boolean;
  inventoryUsagePct: number | null;
  netPosition: number;
  positionSide: PositionSide;
  avgEntryPrice: number | null;
  currentFair: number | null;
  currentBid: number | null;
  currentAsk: number | null;
  fairUnrealizedPnl: number;
  exitPnlAtBestBidAsk: number | null;
  worstCaseLossToZero: number | null;
  worstCaseLossToOne: number | null;
}

const STATUS_RANK: Record<RiskStatus, number> = { OK: 0, WATCH: 1, WARNING: 2, CRITICAL: 3 };

export function maxRiskStatus(statuses: RiskStatus[]): RiskStatus {
  return statuses.reduce<RiskStatus>((max, status) => STATUS_RANK[status] > STATUS_RANK[max] ? status : max, 'OK');
}

export class StrategyRiskManager {
  constructor(private config: StrategyRiskConfig) {}

  evaluateMarket(input: StrategyRiskInput): MarketRiskDecision {
    const netPosition = input.position?.netSize ?? 0;
    const absPosition = Math.abs(netPosition);
    const avgEntryPrice = input.position && netPosition !== 0 ? input.position.avgCost : null;
    const positionSide = this.getPositionSide(netPosition);
    const inventoryUsagePct = this.config.maxMarketExposureContracts > 0
      ? (absPosition / this.config.maxMarketExposureContracts) * 100
      : null;

    const reasons: string[] = [];
    let allowBuy = true;
    let allowSell = true;
    let reduceOnly = false;

    if (inventoryUsagePct !== null && inventoryUsagePct >= this.config.reduceOnlyInventoryLimitPct) {
      reduceOnly = true;
      if (netPosition < 0) {
        allowSell = false;
        reasons.push('reduce_only_short_inventory');
      } else if (netPosition > 0) {
        allowBuy = false;
        reasons.push('reduce_only_long_inventory');
      }
    }

    if (inventoryUsagePct !== null && inventoryUsagePct >= this.config.softInventoryLimitPct) {
      reasons.push('inventory_usage_above_50_pct');
    }

    if (inventoryUsagePct !== null && inventoryUsagePct >= this.config.hardInventoryLimitPct) {
      reasons.push('inventory_limit_above_90_pct');
    }

    if (input.primaryMarketQuoteSharePct !== null && input.primaryMarketQuoteSharePct > this.config.concentrationWarningPct) {
      reasons.push('single_market_concentration_above_90_pct');
    }

    if (input.mode === 'small_live' && input.primaryMarketQuoteSharePct !== null && input.primaryMarketQuoteSharePct > this.config.concentrationCriticalPctLive) {
      reasons.push('live_single_market_concentration_critical');
    }

    if (input.isBookStale && input.hasActiveQuotes) {
      allowBuy = false;
      allowSell = false;
      reasons.push('stale_book_with_active_quotes');
    }

    if (input.killSwitchActive) {
      allowBuy = false;
      allowSell = false;
      reasons.push('kill_switch_active');
    }

    return {
      conditionId: input.conditionId,
      tokenId: input.tokenId,
      riskStatus: this.computeStatus(reasons, inventoryUsagePct),
      reasons,
      reduceOnly,
      allowBuy,
      allowSell,
      inventoryUsagePct,
      netPosition,
      positionSide,
      avgEntryPrice,
      currentFair: input.currentFair,
      currentBid: input.book?.bestBid ?? null,
      currentAsk: input.book?.bestAsk ?? null,
      fairUnrealizedPnl: this.computeFairUnrealizedPnl(netPosition, avgEntryPrice, input.currentFair),
      exitPnlAtBestBidAsk: this.computeExitPnlAtBestBidAsk(netPosition, avgEntryPrice, input.book),
      worstCaseLossToZero: positionSide === 'LONG' && avgEntryPrice !== null ? absPosition * avgEntryPrice : null,
      worstCaseLossToOne: positionSide === 'SHORT' && avgEntryPrice !== null ? absPosition * (1 - avgEntryPrice) : null,
    };
  }

  private getPositionSide(netPosition: number): PositionSide {
    if (netPosition > 0) return 'LONG';
    if (netPosition < 0) return 'SHORT';
    return 'FLAT';
  }

  private computeFairUnrealizedPnl(netPosition: number, avgEntryPrice: number | null, fair: number | null): number {
    if (netPosition === 0 || avgEntryPrice === null || fair === null) return 0;
    if (netPosition > 0) return netPosition * (fair - avgEntryPrice);
    return Math.abs(netPosition) * (avgEntryPrice - fair);
  }

  private computeExitPnlAtBestBidAsk(netPosition: number, avgEntryPrice: number | null, book: BookState | undefined): number | null {
    if (netPosition === 0 || avgEntryPrice === null || !book) return null;
    if (netPosition > 0) {
      if (book.bestBid === null) return null;
      return netPosition * (book.bestBid - avgEntryPrice);
    }
    if (book.bestAsk === null) return null;
    return Math.abs(netPosition) * (avgEntryPrice - book.bestAsk);
  }

  private computeStatus(reasons: string[], inventoryUsagePct: number | null): RiskStatus {
    if (
      reasons.includes('kill_switch_active') ||
      reasons.includes('stale_book_with_active_quotes') ||
      reasons.includes('inventory_limit_above_90_pct') ||
      reasons.includes('live_single_market_concentration_critical')
    ) {
      return 'CRITICAL';
    }

    if (reasons.includes('single_market_concentration_above_90_pct')) {
      return 'WARNING';
    }

    if (inventoryUsagePct !== null && inventoryUsagePct >= this.config.reduceOnlyInventoryLimitPct) {
      return 'WARNING';
    }

    if (inventoryUsagePct !== null && inventoryUsagePct >= this.config.softInventoryLimitPct) {
      return 'WATCH';
    }

    return 'OK';
  }
}
```

- [ ] **Step 4: Run risk manager tests**

Run:

```bash
npx jest tests/risk/strategy-risk-manager.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/risk/strategy-risk-manager.ts tests/risk/strategy-risk-manager.test.ts
git commit -m "feat(risk): add strategy risk manager"
```

---

## Task 4: Telegram Risk Report Formatter

**Files:**
- Create: `src/reporting/telegram-risk-report.ts`
- Create: `tests/reporting/telegram-risk-report.test.ts`

- [ ] **Step 1: Write failing formatter tests**

Create `tests/reporting/telegram-risk-report.test.ts`:

```ts
import { formatTelegramRiskReport, TelegramRiskReportInput } from '../../src/reporting/telegram-risk-report';

function makeInput(overrides: Partial<TelegramRiskReportInput> = {}): TelegramRiskReportInput {
  return {
    mode: 'paper',
    startedAt: new Date('2026-05-03T14:36:45Z'),
    reportAt: new Date('2026-05-06T17:00:00Z'),
    warningsCount: 0,
    errorsCount: 0,
    pnl: {
      realizedPeriod: 0.28,
      realizedCumulative: 4.92,
      unrealizedFairBased: 10.99,
      estimatedMakerRebate: 0.66,
      estimatedTotalPnl: 16.57,
      valuationMode: 'fair',
    },
    activity: {
      fillsTotal: 145,
      buyFills: 31,
      sellFills: 114,
      buyContracts: 61,
      sellContracts: 228,
      totalContracts: 289,
      buyNotional: 32.75,
      sellNotional: 141.34,
      notionalVolume: 174.09,
      avgFillPrice: 0.6012,
      quoteTraces: 7934,
      quoteGeneratedCount: 7934,
      quoteRejectedCount: 0,
      activeMarkets: 3,
      primaryMarketConditionId: 'market-1',
      primaryMarketQuoteTraces: 7930,
      primaryMarketQuoteSharePct: 99.95,
    },
    risk: {
      status: 'WARNING',
      reasons: ['single_market_concentration_above_90_pct', 'reduce_only_short_inventory'],
      reduceOnlyActive: true,
      killSwitchActive: false,
      topMarketDecision: {
        conditionId: 'market-1',
        tokenId: 'token-yes',
        riskStatus: 'WARNING',
        reasons: ['single_market_concentration_above_90_pct', 'reduce_only_short_inventory'],
        reduceOnly: true,
        allowBuy: true,
        allowSell: false,
        inventoryUsagePct: 80,
        netPosition: -167,
        positionSide: 'SHORT',
        avgEntryPrice: 0.6208,
        currentFair: 0.555,
        currentBid: 0.55,
        currentAsk: 0.56,
        fairUnrealizedPnl: 10.99,
        exitPnlAtBestBidAsk: 10.15,
        worstCaseLossToZero: null,
        worstCaseLossToOne: 63.31,
      },
      singleMarketConcentrationPct: 99.95,
      unrealizedToRealizedRatio: 2.23,
    },
    marketTitleByConditionId: new Map([['market-1', 'Russia-Ukraine Ceasefire before GTA VI?']]),
    ...overrides,
  };
}

describe('formatTelegramRiskReport', () => {
  test('formats risk-oriented report with required sections', () => {
    const text = formatTelegramRiskReport(makeInput());

    expect(text).toContain('Oraculus Paper Report');
    expect(text).toContain('Status: WARNING');
    expect(text).toContain('Mode: PAPER');
    expect(text).toContain('Realized Period: +$0.28');
    expect(text).toContain('Realized Total: +$4.92');
    expect(text).toContain('Unrealized: +$10.99');
    expect(text).toContain('Valuation: fair-based');
    expect(text).toContain('Fills: 145');
    expect(text).toContain('BUY: 31 fills / 61 contracts / $32.75');
    expect(text).toContain('SELL: 114 fills / 228 contracts / $141.34');
    expect(text).toContain('Position: SHORT 167');
    expect(text).toContain('Worst Case to YES=1.00: -$63.31');
    expect(text).toContain('Quote Share: 7,930 / 7,934');
    expect(text).not.toContain('Total Trades');
  });

  test('handles missing top market decision', () => {
    const text = formatTelegramRiskReport(makeInput({
      risk: {
        status: 'OK',
        reasons: [],
        reduceOnlyActive: false,
        killSwitchActive: false,
        topMarketDecision: null,
        singleMarketConcentrationPct: null,
        unrealizedToRealizedRatio: null,
      },
    }));

    expect(text).toContain('Status: OK');
    expect(text).toContain('Position: FLAT');
    expect(text).toContain('Main Market');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx jest tests/reporting/telegram-risk-report.test.ts
```

Expected: FAIL because formatter does not exist.

- [ ] **Step 3: Implement formatter**

Create `src/reporting/telegram-risk-report.ts`:

```ts
import { TradingActivitySnapshot } from '../accounting/trading-activity-tracker';
import { MarketRiskDecision, RiskStatus, StrategyMode } from '../risk/strategy-risk-manager';

export interface TelegramRiskReportInput {
  mode: StrategyMode;
  startedAt: Date;
  reportAt: Date;
  warningsCount: number;
  errorsCount: number;
  pnl: {
    realizedPeriod: number;
    realizedCumulative: number;
    unrealizedFairBased: number;
    estimatedMakerRebate: number;
    estimatedTotalPnl: number;
    valuationMode: 'fair' | 'bid_ask' | 'orderbook_depth';
  };
  activity: TradingActivitySnapshot;
  risk: {
    status: RiskStatus;
    reasons: string[];
    reduceOnlyActive: boolean;
    killSwitchActive: boolean;
    topMarketDecision: MarketRiskDecision | null;
    singleMarketConcentrationPct: number | null;
    unrealizedToRealizedRatio: number | null;
  };
  marketTitleByConditionId: Map<string, string>;
}

export function formatTelegramRiskReport(input: TelegramRiskReportInput): string {
  const top = input.risk.topMarketDecision;
  const marketTitle = top ? input.marketTitleByConditionId.get(top.conditionId) ?? top.conditionId : 'n/a';
  const positionText = top ? `${top.positionSide} ${Math.abs(top.netPosition)}` : 'FLAT';
  const avgEntry = top?.avgEntryPrice !== null && top?.avgEntryPrice !== undefined ? top.avgEntryPrice.toFixed(4) : 'n/a';
  const fair = top?.currentFair !== null && top?.currentFair !== undefined ? top.currentFair.toFixed(4) : 'n/a';
  const inventoryUsage = top?.inventoryUsagePct !== null && top?.inventoryUsagePct !== undefined ? `${top.inventoryUsagePct.toFixed(1)}%` : 'n/a';
  const worstCase = top?.worstCaseLossToOne ?? top?.worstCaseLossToZero ?? null;
  const worstCaseLabel = top?.positionSide === 'SHORT' ? 'YES=1.00' : 'YES=0.00';
  const quoteShare = input.activity.primaryMarketConditionId
    ? `${formatInt(input.activity.primaryMarketQuoteTraces)} / ${formatInt(input.activity.quoteTraces)}`
    : 'n/a';

  return `
📊 <b>Oraculus ${capitalize(input.mode)} Report — ${formatDate(input.reportAt)}</b>

${statusEmoji(input.risk.status)} <b>Status: ${input.risk.status}</b>
Reason: ${input.risk.reasons.length > 0 ? input.risk.reasons.join(', ') : 'none'}

🟢 <b>Health</b>
Mode: <b>${input.mode.toUpperCase()}</b>
App Uptime: ${formatDuration(input.reportAt.getTime() - input.startedAt.getTime())}
Errors/Warnings: ${input.errorsCount}/${input.warningsCount}

💰 <b>PnL</b>
Realized Period: ${formatUsdSigned(input.pnl.realizedPeriod)}
Realized Total: ${formatUsdSigned(input.pnl.realizedCumulative)}
Unrealized: ${formatUsdSigned(input.pnl.unrealizedFairBased)}
Est. Rebates: ${formatUsdSigned(input.pnl.estimatedMakerRebate)}
Estimated Total: ${formatUsdSigned(input.pnl.estimatedTotalPnl)}
Valuation: ${valuationLabel(input.pnl.valuationMode)}

📈 <b>Activity</b>
Fills: ${input.activity.fillsTotal}
BUY: ${input.activity.buyFills} fills / ${formatNumber(input.activity.buyContracts)} contracts / ${formatUsd(input.activity.buyNotional)}
SELL: ${input.activity.sellFills} fills / ${formatNumber(input.activity.sellContracts)} contracts / ${formatUsd(input.activity.sellNotional)}
Volume: ${formatNumber(input.activity.totalContracts)} contracts / ${formatUsd(input.activity.notionalVolume)}
Quotes: ${formatInt(input.activity.quoteTraces)} generated: ${formatInt(input.activity.quoteGeneratedCount)} rejected: ${formatInt(input.activity.quoteRejectedCount)}

📦 <b>Inventory</b>
Position: ${positionText}
Avg Entry: ${avgEntry}
Fair: ${fair}
Inventory Usage: ${inventoryUsage}
Reduce-only: ${input.risk.reduceOnlyActive ? 'ON' : 'OFF'}

⚠️ <b>Risk</b>
Market Concentration: ${input.risk.singleMarketConcentrationPct !== null ? `${input.risk.singleMarketConcentrationPct.toFixed(2)}%` : 'n/a'}
Unrealized/Realized: ${input.risk.unrealizedToRealizedRatio !== null ? `${input.risk.unrealizedToRealizedRatio.toFixed(2)}x` : 'n/a'}
Worst Case to ${worstCaseLabel}: ${worstCase !== null ? `-${formatUsd(Math.abs(worstCase))}` : 'n/a'}
Kill Switch: ${input.risk.killSwitchActive ? 'ON' : 'OFF'}
Exit at Bid/Ask: ${top?.exitPnlAtBestBidAsk !== null && top?.exitPnlAtBestBidAsk !== undefined ? formatUsdSigned(top.exitPnlAtBestBidAsk) : 'not available'}

🎯 <b>Main Market</b>
${escapeHtml(marketTitle)}
Quote Share: ${quoteShare}

🧭 <b>Action</b>
${input.mode === 'paper' ? 'Stay PAPER. Before LIVE: inventory cap, reduce-only, bid/ask exit valuation, and concentration limits must stay enabled.' : 'Monitor risk controls before increasing exposure.'}
  `.trim();
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatUsdSigned(value: number): string {
  const sign = value >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatInt(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replace('_', ' ');
}

function valuationLabel(mode: TelegramRiskReportInput['pnl']['valuationMode']): string {
  if (mode === 'fair') return 'fair-based';
  if (mode === 'bid_ask') return 'bid/ask-based';
  return 'orderbook-depth-based';
}

function statusEmoji(status: RiskStatus): string {
  if (status === 'OK') return '🟢';
  if (status === 'WATCH') return '🟡';
  if (status === 'WARNING') return '⚠️';
  return '🚨';
}

function formatDate(date: Date): string {
  return date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
```

- [ ] **Step 4: Run formatter tests**

Run:

```bash
npx jest tests/reporting/telegram-risk-report.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/reporting/telegram-risk-report.ts tests/reporting/telegram-risk-report.test.ts
git commit -m "feat(reporting): format telegram risk report"
```

---

## Task 5: Wire Risk and Activity into `run-paper.ts`

**Files:**
- Modify: `src/run-paper.ts`
- Test indirectly with existing/new unit tests and `npm run build`

- [ ] **Step 1: Add imports**

Modify imports near the top of `src/run-paper.ts`:

```ts
import { TradingActivityTracker } from './accounting/trading-activity-tracker';
import { StrategyRiskManager, maxRiskStatus, MarketRiskDecision } from './risk/strategy-risk-manager';
import { formatTelegramRiskReport } from './reporting/telegram-risk-report';
```

- [ ] **Step 2: Add process health state and trackers**

Inside `main()`, after `const killSwitch = new KillSwitch(defaultConfig.risk);`, add:

```ts
  const startedAt = new Date();
  let warningsCount = 0;
  let errorsCount = 0;
  const activityTracker = new TradingActivityTracker();
  const latestRiskDecisions = new Map<string, MarketRiskDecision>();
```

- [ ] **Step 3: Add risk manager after config is created**

After the `config` object is defined, add:

```ts
  const riskManager = new StrategyRiskManager({
    softInventoryLimitPct: config.inventory.softLimitPct,
    reduceOnlyInventoryLimitPct: 70,
    hardInventoryLimitPct: config.inventory.hardLimitPct,
    maxMarketExposureContracts: Math.max(1, config.inventory.maxMarketExposureUsd),
    concentrationWarningPct: 90,
    concentrationCriticalPctLive: 90,
  });
```

Note: `maxMarketExposureUsd` is used as a conservative contract cap in paper-mode because prices are bounded 0–1 and paper order sizes are small. If this proves too restrictive in production paper, replace it with explicit `maxMarketExposureContracts` config in a follow-up commit.

- [ ] **Step 4: Count warnings/errors where existing logger calls happen**

In the initial book fetch catch block, before `logger.warn(...)`, add:

```ts
      warningsCount += 1;
```

In the market load catch block, before `logger.error(...)`, add:

```ts
    errorsCount += 1;
```

In the WebSocket error callback, change:

```ts
    (err) => logger.error('WS error', { error: err.message })
```

to:

```ts
    (err) => {
      errorsCount += 1;
      logger.error('WS error', { error: err.message });
    }
```

- [ ] **Step 5: Record fill activity**

Inside the fill loop in `evaluateMarket`, after `pnlTracker.onFill(fill, yesFair.fairPrice);`, add:

```ts
        activityTracker.recordFill(market.conditionId, fill);
```

- [ ] **Step 6: Evaluate risk before quote side loop**

In `evaluateMarket`, after `const inventorySkew = getInventorySkew(market.yesTokenId);`, add:

```ts
    const activitySnapshot = activityTracker.snapshot();
    const pos = pnlTracker.getPosition(market.yesTokenId);
    const riskDecision = riskManager.evaluateMarket({
      mode: env.mode,
      conditionId: market.conditionId,
      tokenId: market.yesTokenId,
      position: pos,
      book: yesBook,
      currentFair: yesFair.fairPrice,
      primaryMarketQuoteSharePct: activitySnapshot.primaryMarketQuoteSharePct,
      hasActiveQuotes: paperEngine.getOpenOrders().some(o => o.tokenId === market.yesTokenId),
      isBookStale: isBookStale(yesBook.lastUpdateMs, config.staleOrderMaxAgeMs),
      killSwitchActive: false,
    });
    latestRiskDecisions.set(market.conditionId, riskDecision);
```

Then remove or avoid redeclaring `const pos = pnlTracker.getPosition(market.yesTokenId);` inside the side loop. Use the existing `pos` variable.

- [ ] **Step 7: Gate quote sides through risk manager**

Inside the side loop, immediately after `const aoKey = side === 'BUY' ? 'buy' : 'sell';`, add:

```ts
      if ((side === 'BUY' && !riskDecision.allowBuy) || (side === 'SELL' && !riskDecision.allowSell)) {
        activityTracker.recordQuoteRejected(market.conditionId);
        continue;
      }
```

- [ ] **Step 8: Record generated quote activity**

Inside `for (const quote of quotes)`, immediately before or after `logger.trace(trace);`, add:

```ts
        activityTracker.recordQuoteGenerated(market.conditionId);
```

Use this final sequence:

```ts
        logger.trace(trace);
        activityTracker.recordQuoteGenerated(market.conditionId);
```

- [ ] **Step 9: Replace Telegram report body**

In the scheduled report callback, replace the old `const text = ...` block with:

```ts
      const activity = activityTracker.snapshot();
      const cumulativeRealized = pnlTracker.getCumulativeRealizedPnl();
      const unrealizedFairBased = report.unrealizedPnl;
      const estimatedTotalPnl = cumulativeRealized + unrealizedFairBased + report.estimatedRebate;
      const allDecisions = Array.from(latestRiskDecisions.values());
      const globalRiskStatus = maxRiskStatus(allDecisions.map(d => d.riskStatus));
      const topDecision = activity.primaryMarketConditionId
        ? latestRiskDecisions.get(activity.primaryMarketConditionId) ?? null
        : allDecisions[0] ?? null;
      const realizedAbs = Math.abs(cumulativeRealized);
      const unrealizedToRealizedRatio = realizedAbs > 0 ? Math.abs(unrealizedFairBased) / realizedAbs : null;
      const marketTitleByConditionId = new Map(markets.map(m => [m.conditionId, m.question]));

      const text = formatTelegramRiskReport({
        mode: env.mode,
        startedAt,
        reportAt: new Date(),
        warningsCount,
        errorsCount,
        pnl: {
          realizedPeriod: report.realizedPnl,
          realizedCumulative: cumulativeRealized,
          unrealizedFairBased,
          estimatedMakerRebate: report.estimatedRebate,
          estimatedTotalPnl,
          valuationMode: 'fair',
        },
        activity,
        risk: {
          status: globalRiskStatus,
          reasons: Array.from(new Set(allDecisions.flatMap(d => d.reasons))),
          reduceOnlyActive: allDecisions.some(d => d.reduceOnly),
          killSwitchActive: false,
          topMarketDecision: topDecision,
          singleMarketConcentrationPct: activity.primaryMarketQuoteSharePct,
          unrealizedToRealizedRatio,
        },
        marketTitleByConditionId,
      });
```

Keep `await telegram.sendMessage(text);` unchanged.

- [ ] **Step 10: Run focused tests and build**

Run:

```bash
npx jest tests/accounting/trading-activity-tracker.test.ts tests/risk/strategy-risk-manager.test.ts tests/reporting/telegram-risk-report.test.ts
npm run build
```

Expected: all PASS.

- [ ] **Step 11: Commit**

```bash
git add src/run-paper.ts
git commit -m "feat(strategy): gate paper quotes with risk manager"
```

---

## Task 6: Integration Test for Risk-Gated Paper Behavior

**Files:**
- Create: `tests/integration/risk-gated-paper-report.test.ts`

- [ ] **Step 1: Write integration-style test**

Create `tests/integration/risk-gated-paper-report.test.ts`:

```ts
import { TradingActivityTracker } from '../../src/accounting/trading-activity-tracker';
import { PaperPnlTracker } from '../../src/accounting/paper-pnl-tracker';
import { StrategyRiskManager, maxRiskStatus } from '../../src/risk/strategy-risk-manager';
import { formatTelegramRiskReport } from '../../src/reporting/telegram-risk-report';
import { BookState } from '../../src/types/book';

function makeBook(): BookState {
  return {
    conditionId: 'market-1',
    tokenId: 'token-yes',
    bestBid: 0.55,
    bestAsk: 0.56,
    bestBidSizeUsd: 100,
    bestAskSizeUsd: 100,
    midpoint: 0.555,
    spreadTicks: 1,
    tickSize: 0.01,
    bids: [{ price: 0.55, size: 100 }],
    asks: [{ price: 0.56, size: 100 }],
    lastUpdateMs: Date.now(),
    minOrderSize: 1,
  };
}

describe('risk-gated paper report integration', () => {
  test('large short inventory blocks sell side and appears in report', () => {
    const pnl = new PaperPnlTracker();
    const activity = new TradingActivityTracker();
    const risk = new StrategyRiskManager({
      softInventoryLimitPct: 50,
      reduceOnlyInventoryLimitPct: 70,
      hardInventoryLimitPct: 90,
      maxMarketExposureContracts: 100,
      concentrationWarningPct: 90,
      concentrationCriticalPctLive: 90,
    });

    pnl.onFill({ orderId: 'sell-1', tokenId: 'token-yes', side: 'SELL', filledPrice: 0.62, filledSize: 80, remainingSize: 0 }, 0.62);
    activity.recordFill('market-1', { orderId: 'sell-1', tokenId: 'token-yes', side: 'SELL', filledPrice: 0.62, filledSize: 80, remainingSize: 0 });
    activity.recordQuoteGenerated('market-1');
    activity.recordQuoteGenerated('market-1');

    const decision = risk.evaluateMarket({
      mode: 'paper',
      conditionId: 'market-1',
      tokenId: 'token-yes',
      position: pnl.getPosition('token-yes'),
      book: makeBook(),
      currentFair: 0.555,
      primaryMarketQuoteSharePct: activity.snapshot().primaryMarketQuoteSharePct,
      hasActiveQuotes: true,
      isBookStale: false,
      killSwitchActive: false,
    });

    expect(decision.allowBuy).toBe(true);
    expect(decision.allowSell).toBe(false);
    expect(decision.reduceOnly).toBe(true);

    const text = formatTelegramRiskReport({
      mode: 'paper',
      startedAt: new Date('2026-05-03T14:36:45Z'),
      reportAt: new Date('2026-05-06T17:00:00Z'),
      warningsCount: 0,
      errorsCount: 0,
      pnl: {
        realizedPeriod: 0,
        realizedCumulative: pnl.getCumulativeRealizedPnl(),
        unrealizedFairBased: decision.fairUnrealizedPnl,
        estimatedMakerRebate: 0,
        estimatedTotalPnl: pnl.getCumulativeRealizedPnl() + decision.fairUnrealizedPnl,
        valuationMode: 'fair',
      },
      activity: activity.snapshot(),
      risk: {
        status: maxRiskStatus([decision.riskStatus]),
        reasons: decision.reasons,
        reduceOnlyActive: decision.reduceOnly,
        killSwitchActive: false,
        topMarketDecision: decision,
        singleMarketConcentrationPct: activity.snapshot().primaryMarketQuoteSharePct,
        unrealizedToRealizedRatio: null,
      },
      marketTitleByConditionId: new Map([['market-1', 'Risk Test Market']]),
    });

    expect(text).toContain('Status: WARNING');
    expect(text).toContain('Position: SHORT 80');
    expect(text).toContain('Reduce-only: ON');
    expect(text).toContain('Risk Test Market');
    expect(text).not.toContain('Total Trades');
  });
});
```

- [ ] **Step 2: Run integration test**

Run:

```bash
npx jest tests/integration/risk-gated-paper-report.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/risk-gated-paper-report.test.ts
git commit -m "test: cover risk gated paper reporting"
```

---

## Task 7: Final Verification and Production Readiness Notes

**Files:**
- Modify: `docs/superpowers/specs/2026-05-06-strategy-risk-layer-and-telegram-report-design.md` only if implementation intentionally diverged from spec.

- [ ] **Step 1: Run full verification**

Run:

```bash
npm test
npm run build
git status --short
```

Expected:

- tests PASS;
- build PASS;
- `git status --short` shows no uncommitted files.

- [ ] **Step 2: Inspect generated report format manually**

Run this quick formatter smoke test:

```bash
node - <<'NODE'
const { formatTelegramRiskReport } = require('./dist/reporting/telegram-risk-report');
console.log(formatTelegramRiskReport({
  mode: 'paper',
  startedAt: new Date('2026-05-03T14:36:45Z'),
  reportAt: new Date('2026-05-06T17:00:00Z'),
  warningsCount: 0,
  errorsCount: 0,
  pnl: { realizedPeriod: 0.28, realizedCumulative: 4.92, unrealizedFairBased: 10.99, estimatedMakerRebate: 0.66, estimatedTotalPnl: 16.57, valuationMode: 'fair' },
  activity: { fillsTotal: 145, buyFills: 31, sellFills: 114, buyContracts: 61, sellContracts: 228, totalContracts: 289, buyNotional: 32.75, sellNotional: 141.34, notionalVolume: 174.09, avgFillPrice: 0.6012, quoteTraces: 7934, quoteGeneratedCount: 7934, quoteRejectedCount: 0, activeMarkets: 3, primaryMarketConditionId: 'market-1', primaryMarketQuoteTraces: 7930, primaryMarketQuoteSharePct: 99.95 },
  risk: { status: 'WARNING', reasons: ['single_market_concentration_above_90_pct'], reduceOnlyActive: true, killSwitchActive: false, topMarketDecision: null, singleMarketConcentrationPct: 99.95, unrealizedToRealizedRatio: 2.23 },
  marketTitleByConditionId: new Map([['market-1', 'Russia-Ukraine Ceasefire before GTA VI?']]),
}));
NODE
```

Expected: Output contains `Oraculus Paper Report`, `Fills: 145`, and does not contain `Total Trades`.

- [ ] **Step 3: Commit spec updates if needed**

If no spec changes were needed, skip this step. If implementation changed the design, run:

```bash
git add docs/superpowers/specs/2026-05-06-strategy-risk-layer-and-telegram-report-design.md
git commit -m "docs: update risk report design after implementation"
```

- [ ] **Step 4: Report completion with evidence**

Include:

- commit hashes from Tasks 1–6;
- `npm test` result;
- `npm run build` result;
- note that live remains disabled;
- note that production deploy still needs a separate deployment step.

---

## Self-Review Checklist

- Spec coverage: activity tracking, risk manager, quote gating, Telegram report, tests, rollout, and live-disabled gate are covered.
- Placeholder scan: no `TBD`, `TODO`, or undefined implementation placeholders are intentionally left.
- Type consistency: `TradingActivitySnapshot`, `MarketRiskDecision`, `RiskStatus`, and formatter input are defined before use.
- YAGNI: no database, Docker socket, or full depth liquidation simulator in first implementation.
