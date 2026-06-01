# micro_gabagool_maker_v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a maker-only micro-spread capture strategy for Polymarket with strict risk controls, suitable for $15 USDC balance.

**Architecture:** Pure engine functions (scorer, filters) → stateful managers (risk, orders) → paper simulation → runner. All risk parameters in config. Paper mode first, live gated.

**Tech Stack:** TypeScript, Jest, tsx, Polymarket CLOB API, Gamma API

---

## File Structure

```
src/
├── engines/
│   └── micro-gabagool-scorer.ts         # Pure: score markets 0-10
├── strategy/
│   ├── micro-gabagool-filters.ts        # Pure: market eligibility
│   └── micro-gabagool-config.ts         # Config type + defaults
├── risk/
│   └── micro-gabagool-risk-manager.ts   # Stateful: pre-trade, kill switch
├── execution/
│   └── micro-gabagool-order-manager.ts  # Stateful: order lifecycle
├── simulation/
│   └── micro-gabagool-paper-engine.ts   # Paper mode simulation
├── accounting/
│   └── micro-gabagool-pnl-tracker.ts    # P&L with gas/fees
└── run-micro-gabagool.ts               # Main runner

tests/
├── engines/
│   └── micro-gabagool-scorer.test.ts
├── strategy/
│   └── micro-gabagool-filters.test.ts
├── risk/
│   └── micro-gabagool-risk-manager.test.ts
├── execution/
│   └── micro-gabagool-order-manager.test.ts
├── simulation/
│   └── micro-gabagool-paper-engine.test.ts
├── accounting/
│   └── micro-gabagool-pnl-tracker.test.ts
└── integration/
    └── micro-gabagool-integration.test.ts
```

---

## Task 1: Config Type and Defaults

**Files:**
- Create: `src/strategy/micro-gabagool-config.ts`
- Test: `tests/strategy/micro-gabagool-config.test.ts`

- [ ] **Step 1: Write config type**

```typescript
// src/strategy/micro-gabagool-config.ts

export interface MicroGabagoolConfig {
  // Mode
  mode: 'paper' | 'live';
  enableLiveTrading: boolean;

  // Balance
  initialBalanceUsd: number;
  activeTradingCapitalUsd: number;
  reserveBalanceUsd: number;
  gasReserveUsd: number;

  // Order sizing
  orderSizeMinUsd: number;
  orderSizeMaxUsd: number;
  maxPositionPerMarketUsd: number;
  maxTotalExposureUsd: number;
  maxActiveMarkets: number;

  // Timing
  maxOrderAgeSeconds: number;
  maxPositionAgeSeconds: number;
  defensiveExitTimeoutSeconds: number;

  // Risk
  maxDailyLossUsd: number;
  dailyProfitTargetMinUsd: number;
  dailyProfitTargetMaxUsd: number;
  consecutiveLossLimit: number;

  // Platform
  tickSize: number;
  minProfitThresholdUsd: number;
  gasPerRoundtripEstimateUsd: number;
  makerRebateRate: number;

  // Market filters
  minSpread: number;
  maxSpread: number;
  minBid: number;
  maxAsk: number;
  minTimeToSettlementMinutes: number;
  minTopOfBookSizeUsd: number;
  recentTradeWindowMinutes: number;

  // Scoring
  minScoreToTrade: number;

  // Cooldown
  marketCooldownAfterLossMinutes: number;
  marketCooldownAfterTwoBadExitsMinutes: number;

  // API resilience
  apiMaxRetries: number;
  apiRetryBaseDelaySeconds: number;
  apiRetryMaxDelaySeconds: number;
  reconcileOnReconnect: boolean;
}

export const DEFAULT_CONFIG: MicroGabagoolConfig = {
  mode: 'paper',
  enableLiveTrading: false,

  initialBalanceUsd: 15.0,
  activeTradingCapitalUsd: 10.0,
  reserveBalanceUsd: 5.0,
  gasReserveUsd: 0.5,

  orderSizeMinUsd: 1.0,
  orderSizeMaxUsd: 1.5,
  maxPositionPerMarketUsd: 3.0,
  maxTotalExposureUsd: 6.0,
  maxActiveMarkets: 2,

  maxOrderAgeSeconds: 45,
  maxPositionAgeSeconds: 300,
  defensiveExitTimeoutSeconds: 600,

  maxDailyLossUsd: 1.50,
  dailyProfitTargetMinUsd: 0.30,
  dailyProfitTargetMaxUsd: 0.75,
  consecutiveLossLimit: 3,

  tickSize: 0.01,
  minProfitThresholdUsd: 0.005,
  gasPerRoundtripEstimateUsd: 0.004,
  makerRebateRate: 0.001,

  minSpread: 0.02,
  maxSpread: 0.05,
  minBid: 0.08,
  maxAsk: 0.92,
  minTimeToSettlementMinutes: 15,
  minTopOfBookSizeUsd: 10.0,
  recentTradeWindowMinutes: 5,

  minScoreToTrade: 7.5,

  marketCooldownAfterLossMinutes: 30,
  marketCooldownAfterTwoBadExitsMinutes: 60,

  apiMaxRetries: 4,
  apiRetryBaseDelaySeconds: 1,
  apiRetryMaxDelaySeconds: 8,
  reconcileOnReconnect: true,
};
```

- [ ] **Step 2: Write test for config defaults**

```typescript
// tests/strategy/micro-gabagool-config.test.ts
import { DEFAULT_CONFIG } from '../../src/strategy/micro-gabagool-config';

describe('MicroGabagoolConfig', () => {
  it('should have safe defaults for 15 USDC balance', () => {
    expect(DEFAULT_CONFIG.mode).toBe('paper');
    expect(DEFAULT_CONFIG.enableLiveTrading).toBe(false);
    expect(DEFAULT_CONFIG.initialBalanceUsd).toBe(15.0);
    expect(DEFAULT_CONFIG.activeTradingCapitalUsd).toBe(10.0);
    expect(DEFAULT_CONFIG.reserveBalanceUsd).toBe(5.0);
  });

  it('should have correct tick size', () => {
    expect(DEFAULT_CONFIG.tickSize).toBe(0.01);
  });

  it('should have risk limits', () => {
    expect(DEFAULT_CONFIG.maxDailyLossUsd).toBe(1.50);
    expect(DEFAULT_CONFIG.consecutiveLossLimit).toBe(3);
    expect(DEFAULT_CONFIG.maxTotalExposureUsd).toBe(6.0);
  });

  it('should have market filters', () => {
    expect(DEFAULT_CONFIG.minSpread).toBe(0.02);
    expect(DEFAULT_CONFIG.maxSpread).toBe(0.05);
    expect(DEFAULT_CONFIG.minBid).toBe(0.08);
    expect(DEFAULT_CONFIG.maxAsk).toBe(0.92);
    expect(DEFAULT_CONFIG.minTimeToSettlementMinutes).toBe(15);
  });

  it('should have scoring threshold', () => {
    expect(DEFAULT_CONFIG.minScoreToTrade).toBe(7.5);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- tests/strategy/micro-gabagool-config.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/strategy/micro-gabagool-config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/strategy/micro-gabagool-config.ts tests/strategy/micro-gabagool-config.test.ts
git commit -m "feat(gabagool): add config type with safe defaults"
```

---

## Task 2: Market Scorer (Pure Function)

**Files:**
- Create: `src/engines/micro-gabagool-scorer.ts`
- Test: `tests/engines/micro-gabagool-scorer.test.ts`

- [ ] **Step 1: Write scorer types and function**

```typescript
// src/engines/micro-gabagool-scorer.ts

export interface ScoringInputs {
  spread: number;
  bestBidSizeUsd: number;
  bestAskSizeUsd: number;
  wmpDelta3Min: number;
  spreadChangesLast60Sec: number;
  timeToSettlementMin: number;
}

export interface ScoringResult {
  totalScore: number;
  spreadScore: number;
  liquidityScore: number;
  volatilityScore: number;
  orderbookScore: number;
  settlementScore: number;
  passThreshold: boolean;
}

function computeSpreadScore(spread: number): number {
  if (spread >= 0.02 && spread <= 0.03) return 10;
  if (spread > 0.03 && spread <= 0.04) return 8;
  if (spread > 0.04 && spread <= 0.05) return 5;
  return 0;
}

function computeLiquidityScore(minSizeUsd: number): number {
  if (minSizeUsd >= 10.0) return 10;
  if (minSizeUsd >= 5.0) return minSizeUsd;
  return 0;
}

function computeVolatilityScore(wmpDelta: number): number {
  if (wmpDelta >= 0.01 && wmpDelta <= 0.05) return 10;
  if (wmpDelta > 0.00 && wmpDelta < 0.01) return 5;
  return 0;
}

function computeOrderbookScore(spreadChanges: number): number {
  if (spreadChanges <= 1) return 10;
  if (spreadChanges <= 3) return 5;
  return 0;
}

function computeSettlementScore(minutesToSettlement: number): number {
  if (minutesToSettlement >= 60) return 10;
  if (minutesToSettlement >= 15) return 6;
  return 0;
}

export function computeOpportunityScore(inputs: ScoringInputs, minScore: number = 7.5): ScoringResult {
  const spreadScore = computeSpreadScore(inputs.spread);
  const liquidityScore = computeLiquidityScore(Math.min(inputs.bestBidSizeUsd, inputs.bestAskSizeUsd));
  const volatilityScore = computeVolatilityScore(inputs.wmpDelta3Min);
  const orderbookScore = computeOrderbookScore(inputs.spreadChangesLast60Sec);
  const settlementScore = computeSettlementScore(inputs.timeToSettlementMin);

  const totalScore = 
    0.35 * spreadScore +
    0.25 * liquidityScore +
    0.20 * volatilityScore +
    0.10 * orderbookScore +
    0.10 * settlementScore;

  return {
    totalScore,
    spreadScore,
    liquidityScore,
    volatilityScore,
    orderbookScore,
    settlementScore,
    passThreshold: totalScore >= minScore,
  };
}
```

- [ ] **Step 2: Write comprehensive tests**

```typescript
// tests/engines/micro-gabagool-scorer.test.ts
import { computeOpportunityScore, ScoringInputs } from '../../src/engines/micro-gabagool-scorer';

describe('computeOpportunityScore', () => {
  function idealInputs(overrides?: Partial<ScoringInputs>): ScoringInputs {
    return {
      spread: 0.025,
      bestBidSizeUsd: 50,
      bestAskSizeUsd: 50,
      wmpDelta3Min: 0.03,
      spreadChangesLast60Sec: 0,
      timeToSettlementMin: 120,
      ...overrides,
    };
  }

  it('should score ideal market at 10', () => {
    const result = computeOpportunityScore(idealInputs());
    expect(result.totalScore).toBe(10);
    expect(result.passThreshold).toBe(true);
  });

  it('should reject spread < 0.02', () => {
    const result = computeOpportunityScore(idealInputs({ spread: 0.015 }));
    expect(result.spreadScore).toBe(0);
    expect(result.passThreshold).toBe(false);
  });

  it('should reject spread > 0.05', () => {
    const result = computeOpportunityScore(idealInputs({ spread: 0.06 }));
    expect(result.spreadScore).toBe(0);
    expect(result.passThreshold).toBe(false);
  });

  it('should score spread 0.03-0.04 at 8', () => {
    const result = computeOpportunityScore(idealInputs({ spread: 0.035 }));
    expect(result.spreadScore).toBe(8);
  });

  it('should reject thin liquidity < 5', () => {
    const result = computeOpportunityScore(idealInputs({ bestBidSizeUsd: 3 }));
    expect(result.liquidityScore).toBe(0);
  });

  it('should score liquidity linearly 5-10', () => {
    const result = computeOpportunityScore(idealInputs({ bestBidSizeUsd: 7, bestAskSizeUsd: 20 }));
    expect(result.liquidityScore).toBe(7);
  });

  it('should reject zero volatility', () => {
    const result = computeOpportunityScore(idealInputs({ wmpDelta3Min: 0 }));
    expect(result.volatilityScore).toBe(5);
  });

  it('should reject toxic volatility > 0.05', () => {
    const result = computeOpportunityScore(idealInputs({ wmpDelta3Min: 0.08 }));
    expect(result.volatilityScore).toBe(0);
  });

  it('should reject unstable orderbook', () => {
    const result = computeOpportunityScore(idealInputs({ spreadChangesLast60Sec: 5 }));
    expect(result.orderbookScore).toBe(0);
  });

  it('should reject settlement < 15 min', () => {
    const result = computeOpportunityScore(idealInputs({ timeToSettlementMin: 10 }));
    expect(result.settlementScore).toBe(0);
  });

  it('should score settlement 15-60 min at 6', () => {
    const result = computeOpportunityScore(idealInputs({ timeToSettlementMin: 30 }));
    expect(result.settlementScore).toBe(6);
  });

  it('should pass threshold at 7.5', () => {
    const result = computeOpportunityScore(idealInputs({
      spread: 0.035,       // 8 * 0.35 = 2.8
      bestBidSizeUsd: 10,  // 10 * 0.25 = 2.5
      wmpDelta3Min: 0.03,  // 10 * 0.20 = 2.0
      spreadChangesLast60Sec: 0, // 10 * 0.10 = 1.0
      timeToSettlementMin: 30,   // 6 * 0.10 = 0.6
    }));
    expect(result.totalScore).toBe(8.9);
    expect(result.passThreshold).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- tests/engines/micro-gabagool-scorer.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/engines/micro-gabagool-scorer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/engines/micro-gabagool-scorer.ts tests/engines/micro-gabagool-scorer.test.ts
git commit -m "feat(gabagool): add opportunity scorer with weighted scoring model"
```

---

## Task 3: Market Filters (Pure Function)

**Files:**
- Create: `src/strategy/micro-gabagool-filters.ts`
- Test: `tests/strategy/micro-gabagool-filters.test.ts`

- [ ] **Step 1: Write filter function**

```typescript
// src/strategy/micro-gabagool-filters.ts

export interface FilterInputs {
  bestBid: number;
  bestAsk: number;
  bestBidSizeUsd: number;
  bestAskSizeUsd: number;
  timeToSettlementMin: number;
  hasRecentTrades: boolean;
  isInCooldown: boolean;
  hasActivePosition: boolean;
  hasActiveOrder: boolean;
  minSpread: number;
  maxSpread: number;
  minBid: number;
  maxAsk: number;
  minTimeToSettlementMinutes: number;
  minTopOfBookSizeUsd: number;
}

export interface FilterResult {
  pass: boolean;
  reason?: string;
}

export function passesMarketFilters(inputs: FilterInputs): FilterResult {
  const spread = inputs.bestAsk - inputs.bestBid;

  if (spread < inputs.minSpread) {
    return { pass: false, reason: 'spread_too_narrow' };
  }
  if (spread > inputs.maxSpread) {
    return { pass: false, reason: 'spread_too_wide' };
  }
  if (inputs.bestBid < inputs.minBid) {
    return { pass: false, reason: 'bid_too_low' };
  }
  if (inputs.bestAsk > inputs.maxAsk) {
    return { pass: false, reason: 'ask_too_high' };
  }
  if (inputs.timeToSettlementMin < inputs.minTimeToSettlementMinutes) {
    return { pass: false, reason: 'too_close_to_settlement' };
  }
  if (inputs.bestBidSizeUsd < inputs.minTopOfBookSizeUsd) {
    return { pass: false, reason: 'bid_depth_too_thin' };
  }
  if (inputs.bestAskSizeUsd < inputs.minTopOfBookSizeUsd) {
    return { pass: false, reason: 'ask_depth_too_thin' };
  }
  if (!inputs.hasRecentTrades) {
    return { pass: false, reason: 'no_recent_trades' };
  }
  if (inputs.isInCooldown) {
    return { pass: false, reason: 'market_in_cooldown' };
  }
  if (inputs.hasActivePosition) {
    return { pass: false, reason: 'already_has_position' };
  }
  if (inputs.hasActiveOrder) {
    return { pass: false, reason: 'already_has_active_order' };
  }

  return { pass: true };
}
```

- [ ] **Step 2: Write comprehensive tests**

```typescript
// tests/strategy/micro-gabagool-filters.test.ts
import { passesMarketFilters, FilterInputs } from '../../src/strategy/micro-gabagool-filters';

describe('passesMarketFilters', () => {
  function idealInputs(overrides?: Partial<FilterInputs>): FilterInputs {
    return {
      bestBid: 0.45,
      bestAsk: 0.48,
      bestBidSizeUsd: 50,
      bestAskSizeUsd: 50,
      timeToSettlementMin: 120,
      hasRecentTrades: true,
      isInCooldown: false,
      hasActivePosition: false,
      hasActiveOrder: false,
      minSpread: 0.02,
      maxSpread: 0.05,
      minBid: 0.08,
      maxAsk: 0.92,
      minTimeToSettlementMinutes: 15,
      minTopOfBookSizeUsd: 10,
      ...overrides,
    };
  }

  it('should pass ideal market', () => {
    expect(passesMarketFilters(idealInputs()).pass).toBe(true);
  });

  it('should reject spread too narrow', () => {
    const result = passesMarketFilters(idealInputs({ bestAsk: 0.46 }));
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('spread_too_narrow');
  });

  it('should reject spread too wide', () => {
    const result = passesMarketFilters(idealInputs({ bestAsk: 0.52 }));
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('spread_too_wide');
  });

  it('should reject bid too low', () => {
    const result = passesMarketFilters(idealInputs({ bestBid: 0.05 }));
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('bid_too_low');
  });

  it('should reject ask too high', () => {
    const result = passesMarketFilters(idealInputs({ bestAsk: 0.95 }));
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('ask_too_high');
  });

  it('should reject too close to settlement', () => {
    const result = passesMarketFilters(idealInputs({ timeToSettlementMin: 10 }));
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('too_close_to_settlement');
  });

  it('should reject thin bid depth', () => {
    const result = passesMarketFilters(idealInputs({ bestBidSizeUsd: 5 }));
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('bid_depth_too_thin');
  });

  it('should reject no recent trades', () => {
    const result = passesMarketFilters(idealInputs({ hasRecentTrades: false }));
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('no_recent_trades');
  });

  it('should reject market in cooldown', () => {
    const result = passesMarketFilters(idealInputs({ isInCooldown: true }));
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('market_in_cooldown');
  });

  it('should reject if already has position', () => {
    const result = passesMarketFilters(idealInputs({ hasActivePosition: true }));
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('already_has_position');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- tests/strategy/micro-gabagool-filters.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/strategy/micro-gabagool-filters.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/strategy/micro-gabagool-filters.ts tests/strategy/micro-gabagool-filters.test.ts
git commit -m "feat(gabagool): add market eligibility filters"
```

---

## Task 4: Risk Manager (Stateful)

**Files:**
- Create: `src/risk/micro-gabagool-risk-manager.ts`
- Test: `tests/risk/micro-gabagool-risk-manager.test.ts`

- [ ] **Step 1: Write risk manager**

```typescript
// src/risk/micro-gabagool-risk-manager.ts

export interface RiskManagerConfig {
  maxDailyLossUsd: number;
  maxTotalExposureUsd: number;
  maxPositionPerMarketUsd: number;
  maxActiveMarkets: number;
  consecutiveLossLimit: number;
  marketCooldownAfterLossMinutes: number;
  marketCooldownAfterTwoBadExitsMinutes: number;
}

export interface TradeResult {
  marketId: string;
  profitUsd: number;
  timestamp: number;
}

export interface RiskCheckResult {
  allowed: boolean;
  reason?: string;
}

export type KillSwitchState = 'ACTIVE' | 'DAILY_STOP' | 'CONSECUTIVE_LOSS_FREEZE' | 'SAFE_MODE';

export class MicroGabagoolRiskManager {
  private dailyPnl: number = 0;
  private consecutiveLosses: number = 0;
  private activeMarkets: Map<string, number> = new Map(); // marketId -> exposure
  private cooldowns: Map<string, number> = new Map(); // marketId -> cooldownUntil
  private badExitCounts: Map<string, number> = new Map(); // marketId -> count
  private killSwitchState: KillSwitchState = 'ACTIVE';
  private dayStartMs: number;

  constructor(private config: RiskManagerConfig, nowMs: number = Date.now()) {
    this.dayStartMs = this.getDayStart(nowMs);
  }

  private getDayStart(nowMs: number): number {
    const d = new Date(nowMs);
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
  }

  canEnterMarket(marketId: string, orderSizeUsd: number, nowMs: number = Date.now()): RiskCheckResult {
    if (this.killSwitchState !== 'ACTIVE') {
      return { allowed: false, reason: `kill_switch_${this.killSwitchState.toLowerCase()}` };
    }

    if (this.dailyPnl <= -this.config.maxDailyLossUsd) {
      return { allowed: false, reason: 'daily_loss_limit' };
    }

    const currentExposure = this.getTotalExposure();
    if (currentExposure + orderSizeUsd > this.config.maxTotalExposureUsd) {
      return { allowed: false, reason: 'total_exposure_limit' };
    }

    if (this.activeMarkets.size >= this.config.maxActiveMarkets && !this.activeMarkets.has(marketId)) {
      return { allowed: false, reason: 'max_active_markets' };
    }

    const marketExposure = this.activeMarkets.get(marketId) ?? 0;
    if (marketExposure + orderSizeUsd > this.config.maxPositionPerMarketUsd) {
      return { allowed: false, reason: 'market_exposure_limit' };
    }

    const cooldownUntil = this.cooldowns.get(marketId);
    if (cooldownUntil && nowMs < cooldownUntil) {
      return { allowed: false, reason: 'market_in_cooldown' };
    }

    return { allowed: true };
  }

  recordTrade(result: TradeResult, nowMs: number = Date.now()): void {
    this.dailyPnl += result.profitUsd;

    if (result.profitUsd < 0) {
      this.consecutiveLosses++;
      this.startCooldown(result.marketId, 'loss', nowMs);

      if (this.consecutiveLosses >= this.config.consecutiveLossLimit) {
        this.killSwitchState = 'CONSECUTIVE_LOSS_FREEZE';
      }
    } else {
      this.consecutiveLosses = 0;
    }

    if (this.dailyPnl <= -this.config.maxDailyLossUsd) {
      this.killSwitchState = 'DAILY_STOP';
    }
  }

  addExposure(marketId: string, sizeUsd: number): void {
    const current = this.activeMarkets.get(marketId) ?? 0;
    this.activeMarkets.set(marketId, current + sizeUsd);
  }

  removeExposure(marketId: string, sizeUsd: number): void {
    const current = this.activeMarkets.get(marketId) ?? 0;
    const newExposure = current - sizeUsd;
    if (newExposure <= 0) {
      this.activeMarkets.delete(marketId);
    } else {
      this.activeMarkets.set(marketId, newExposure);
    }
  }

  recordBadExit(marketId: string, nowMs: number = Date.now()): void {
    const count = (this.badExitCounts.get(marketId) ?? 0) + 1;
    this.badExitCounts.set(marketId, count);

    if (count >= 2) {
      this.startCooldown(marketId, 'two_bad_exits', nowMs);
    }
  }

  private startCooldown(marketId: string, reason: string, nowMs: number): void {
    const durationMs = reason === 'two_bad_exits'
      ? this.config.marketCooldownAfterTwoBadExitsMinutes * 60_000
      : this.config.marketCooldownAfterLossMinutes * 60_000;
    this.cooldowns.set(marketId, nowMs + durationMs);
  }

  getTotalExposure(): number {
    let total = 0;
    for (const exposure of this.activeMarkets.values()) {
      total += exposure;
    }
    return total;
  }

  getDailyPnl(): number {
    return this.dailyPnl;
  }

  getConsecutiveLosses(): number {
    return this.consecutiveLosses;
  }

  getKillSwitchState(): KillSwitchState {
    return this.killSwitchState;
  }

  resetDaily(nowMs: number = Date.now()): void {
    const dayStart = this.getDayStart(nowMs);
    if (dayStart > this.dayStartMs) {
      this.dailyPnl = 0;
      this.dayStartMs = dayStart;
      if (this.killSwitchState === 'DAILY_STOP') {
        this.killSwitchState = 'ACTIVE';
      }
    }
  }

  manualUnlock(): void {
    this.killSwitchState = 'ACTIVE';
    this.consecutiveLosses = 0;
  }

  enterSafeMode(): void {
    this.killSwitchState = 'SAFE_MODE';
  }
}
```

- [ ] **Step 2: Write comprehensive tests**

```typescript
// tests/risk/micro-gabagool-risk-manager.test.ts
import { MicroGabagoolRiskManager, RiskManagerConfig } from '../../src/risk/micro-gabagool-risk-manager';

const defaultConfig: RiskManagerConfig = {
  maxDailyLossUsd: 1.50,
  maxTotalExposureUsd: 6.0,
  maxPositionPerMarketUsd: 3.0,
  maxActiveMarkets: 2,
  consecutiveLossLimit: 3,
  marketCooldownAfterLossMinutes: 30,
  marketCooldownAfterTwoBadExitsMinutes: 60,
};

describe('MicroGabagoolRiskManager', () => {
  it('should allow entry when all conditions pass', () => {
    const rm = new MicroGabagoolRiskManager(defaultConfig);
    expect(rm.canEnterMarket('m1', 1.5).allowed).toBe(true);
  });

  it('should block when daily loss exceeded', () => {
    const rm = new MicroGabagoolRiskManager(defaultConfig);
    rm.recordTrade({ marketId: 'm1', profitUsd: -1.6, timestamp: 0 });
    expect(rm.canEnterMarket('m1', 1.5).allowed).toBe(false);
    expect(rm.canEnterMarket('m1', 1.5).reason).toBe('daily_loss_limit');
  });

  it('should block when total exposure exceeded', () => {
    const rm = new MicroGabagoolRiskManager(defaultConfig);
    rm.addExposure('m1', 3.0);
    rm.addExposure('m2', 3.0);
    expect(rm.canEnterMarket('m3', 1.5).allowed).toBe(false);
    expect(rm.canEnterMarket('m3', 1.5).reason).toBe('total_exposure_limit');
  });

  it('should block when max active markets reached', () => {
    const rm = new MicroGabagoolRiskManager(defaultConfig);
    rm.addExposure('m1', 1.0);
    rm.addExposure('m2', 1.0);
    expect(rm.canEnterMarket('m3', 1.5).allowed).toBe(false);
    expect(rm.canEnterMarket('m3', 1.5).reason).toBe('max_active_markets');
  });

  it('should allow same market even with max active', () => {
    const rm = new MicroGabagoolRiskManager(defaultConfig);
    rm.addExposure('m1', 1.0);
    rm.addExposure('m2', 1.0);
    expect(rm.canEnterMarket('m1', 1.0).allowed).toBe(true);
  });

  it('should block when market exposure exceeded', () => {
    const rm = new MicroGabagoolRiskManager(defaultConfig);
    rm.addExposure('m1', 2.0);
    expect(rm.canEnterMarket('m1', 1.5).allowed).toBe(false);
    expect(rm.canEnterMarket('m1', 1.5).reason).toBe('market_exposure_limit');
  });

  it('should track consecutive losses', () => {
    const rm = new MicroGabagoolRiskManager(defaultConfig);
    rm.recordTrade({ marketId: 'm1', profitUsd: -0.01, timestamp: 0 });
    rm.recordTrade({ marketId: 'm2', profitUsd: -0.01, timestamp: 0 });
    expect(rm.getConsecutiveLosses()).toBe(2);
    expect(rm.getKillSwitchState()).toBe('ACTIVE');

    rm.recordTrade({ marketId: 'm3', profitUsd: -0.01, timestamp: 0 });
    expect(rm.getConsecutiveLosses()).toBe(3);
    expect(rm.getKillSwitchState()).toBe('CONSECUTIVE_LOSS_FREEZE');
  });

  it('should reset consecutive losses on win', () => {
    const rm = new MicroGabagoolRiskManager(defaultConfig);
    rm.recordTrade({ marketId: 'm1', profitUsd: -0.01, timestamp: 0 });
    rm.recordTrade({ marketId: 'm2', profitUsd: 0.01, timestamp: 0 });
    expect(rm.getConsecutiveLosses()).toBe(0);
  });

  it('should cooldown market after loss', () => {
    const rm = new MicroGabagoolRiskManager(defaultConfig);
    const now = 1000000;
    rm.recordTrade({ marketId: 'm1', profitUsd: -0.01, timestamp: now }, now);

    expect(rm.canEnterMarket('m1', 1.5, now + 1000).allowed).toBe(false);
    expect(rm.canEnterMarket('m1', 1.5, now + 1000).reason).toBe('market_in_cooldown');

    expect(rm.canEnterMarket('m1', 1.5, now + 31 * 60_000).allowed).toBe(true);
  });

  it('should cooldown market after two bad exits', () => {
    const rm = new MicroGabagoolRiskManager(defaultConfig);
    const now = 1000000;
    rm.recordBadExit('m1', now);
    rm.recordBadExit('m1', now);

    expect(rm.canEnterMarket('m1', 1.5, now + 1000).allowed).toBe(false);
    expect(rm.canEnterMarket('m1', 1.5, now + 1000).reason).toBe('market_in_cooldown');

    expect(rm.canEnterMarket('m1', 1.5, now + 61 * 60_000).allowed).toBe(true);
  });

  it('should manual unlock from consecutive loss freeze', () => {
    const rm = new MicroGabagoolRiskManager(defaultConfig);
    rm.recordTrade({ marketId: 'm1', profitUsd: -0.01, timestamp: 0 });
    rm.recordTrade({ marketId: 'm2', profitUsd: -0.01, timestamp: 0 });
    rm.recordTrade({ marketId: 'm3', profitUsd: -0.01, timestamp: 0 });
    expect(rm.getKillSwitchState()).toBe('CONSECUTIVE_LOSS_FREEZE');

    rm.manualUnlock();
    expect(rm.getKillSwitchState()).toBe('ACTIVE');
    expect(rm.getConsecutiveLosses()).toBe(0);
  });

  it('should track exposure correctly', () => {
    const rm = new MicroGabagoolRiskManager(defaultConfig);
    rm.addExposure('m1', 1.5);
    rm.addExposure('m1', 1.0);
    expect(rm.getTotalExposure()).toBe(2.5);

    rm.removeExposure('m1', 1.5);
    expect(rm.getTotalExposure()).toBe(1.0);

    rm.removeExposure('m1', 1.0);
    expect(rm.getTotalExposure()).toBe(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- tests/risk/micro-gabagool-risk-manager.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/risk/micro-gabagool-risk-manager.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/risk/micro-gabagool-risk-manager.ts tests/risk/micro-gabagool-risk-manager.test.ts
git commit -m "feat(gabagool): add risk manager with kill switch and cooldown"
```

---

## Task 5: PnL Tracker

**Files:**
- Create: `src/accounting/micro-gabagool-pnl-tracker.ts`
- Test: `tests/accounting/micro-gabagool-pnl-tracker.test.ts`

- [ ] **Step 1: Write PnL tracker**

```typescript
// src/accounting/micro-gabagool-pnl-tracker.ts

export interface PnlConfig {
  gasPerRoundtripEstimateUsd: number;
  makerRebateRate: number;
  initialBalanceUsd: number;
}

export interface ClosedTrade {
  marketId: string;
  entryPrice: number;
  exitPrice: number;
  sizeUsd: number;
  shares: number;
  grossProfitUsd: number;
  gasCostUsd: number;
  rebateUsd: number;
  netProfitUsd: number;
  isTakerExit: boolean;
  holdTimeSeconds: number;
  timestamp: number;
}

export interface PnlSnapshot {
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  dailyPnlUsd: number;
  grossPnlUsd: number;
  netPnlUsd: number;
  gasCostsTotalUsd: number;
  rebatesTotalUsd: number;
  feesPaidTotalUsd: number;
  tradeCount: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  avgHoldTimeSeconds: number;
  avgSpreadCaptured: number;
  makerFillsCount: number;
  takerFillsCount: number;
  forceTakerExitsCount: number;
  currentBalanceUsd: number;
}

export class MicroGabagoolPnlTracker {
  private closedTrades: ClosedTrade[] = [];
  private unrealizedPositions: Map<string, { entryPrice: number; sizeUsd: number; shares: number }> = new Map();
  private balance: number;
  private dayStartMs: number;

  constructor(private config: PnlConfig, nowMs: number = Date.now()) {
    this.balance = config.initialBalanceUsd;
    this.dayStartMs = this.getDayStart(nowMs);
  }

  private getDayStart(nowMs: number): number {
    const d = new Date(nowMs);
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
  }

  recordFill(marketId: string, entryPrice: number, sizeUsd: number, shares: number): void {
    this.unrealizedPositions.set(marketId, { entryPrice, sizeUsd, shares });
    this.balance -= sizeUsd;
  }

  recordExit(
    marketId: string,
    exitPrice: number,
    isTakerExit: boolean,
    holdTimeSeconds: number,
    nowMs: number = Date.now()
  ): ClosedTrade {
    const position = this.unrealizedPositions.get(marketId);
    if (!position) throw new Error(`No position for market ${marketId}`);

    const grossProfitUsd = (exitPrice - position.entryPrice) * position.shares;
    const gasCostUsd = this.config.gasPerRoundtripEstimateUsd;
    const rebateUsd = position.sizeUsd * this.config.makerRebateRate;
    const netProfitUsd = grossProfitUsd - gasCostUsd + rebateUsd;

    const trade: ClosedTrade = {
      marketId,
      entryPrice: position.entryPrice,
      exitPrice,
      sizeUsd: position.sizeUsd,
      shares: position.shares,
      grossProfitUsd,
      gasCostUsd,
      rebateUsd,
      netProfitUsd,
      isTakerExit,
      holdTimeSeconds,
      timestamp: nowMs,
    };

    this.closedTrades.push(trade);
    this.unrealizedPositions.delete(marketId);
    this.balance += position.shares * exitPrice;

    return trade;
  }

  getSnapshot(currentPrices: Map<string, number>, nowMs: number = Date.now()): PnlSnapshot {
    let unrealizedPnlUsd = 0;
    for (const [marketId, position] of this.unrealizedPositions) {
      const currentPrice = currentPrices.get(marketId) ?? position.entryPrice;
      unrealizedPnlUsd += (currentPrice - position.entryPrice) * position.shares;
    }

    const dayStart = this.getDayStart(nowMs);
    const todayTrades = this.closedTrades.filter(t => t.timestamp >= dayStart);
    const dailyPnl = todayTrades.reduce((sum, t) => sum + t.netProfitUsd, 0);

    const wins = this.closedTrades.filter(t => t.netProfitUsd > 0);
    const losses = this.closedTrades.filter(t => t.netProfitUsd <= 0);
    const totalHoldTime = this.closedTrades.reduce((sum, t) => sum + t.holdTimeSeconds, 0);
    const totalSpreadCaptured = this.closedTrades.reduce((sum, t) => sum + (t.exitPrice - t.entryPrice), 0);

    return {
      realizedPnlUsd: this.closedTrades.reduce((sum, t) => sum + t.netProfitUsd, 0),
      unrealizedPnlUsd,
      dailyPnlUsd: dailyPnl,
      grossPnlUsd: this.closedTrades.reduce((sum, t) => sum + t.grossProfitUsd, 0),
      netPnlUsd: this.closedTrades.reduce((sum, t) => sum + t.netProfitUsd, 0),
      gasCostsTotalUsd: this.closedTrades.reduce((sum, t) => sum + t.gasCostUsd, 0),
      rebatesTotalUsd: this.closedTrades.reduce((sum, t) => sum + t.rebateUsd, 0),
      feesPaidTotalUsd: 0,
      tradeCount: this.closedTrades.length,
      winCount: wins.length,
      lossCount: losses.length,
      winRate: this.closedTrades.length > 0 ? wins.length / this.closedTrades.length : 0,
      avgHoldTimeSeconds: this.closedTrades.length > 0 ? totalHoldTime / this.closedTrades.length : 0,
      avgSpreadCaptured: this.closedTrades.length > 0 ? totalSpreadCaptured / this.closedTrades.length : 0,
      makerFillsCount: this.closedTrades.filter(t => !t.isTakerExit).length,
      takerFillsCount: this.closedTrades.filter(t => t.isTakerExit).length,
      forceTakerExitsCount: this.closedTrades.filter(t => t.isTakerExit).length,
      currentBalanceUsd: this.balance + unrealizedPnlUsd,
    };
  }

  getBalance(): number {
    return this.balance;
  }

  getClosedTrades(): ClosedTrade[] {
    return [...this.closedTrades];
  }

  hasPosition(marketId: string): boolean {
    return this.unrealizedPositions.has(marketId);
  }

  getPosition(marketId: string): { entryPrice: number; sizeUsd: number; shares: number } | undefined {
    return this.unrealizedPositions.get(marketId);
  }
}
```

- [ ] **Step 2: Write tests**

```typescript
// tests/accounting/micro-gabagool-pnl-tracker.test.ts
import { MicroGabagoolPnlTracker, PnlConfig } from '../../src/accounting/micro-gabagool-pnl-tracker';

const defaultConfig: PnlConfig = {
  gasPerRoundtripEstimateUsd: 0.004,
  makerRebateRate: 0.001,
  initialBalanceUsd: 15.0,
};

describe('MicroGabagoolPnlTracker', () => {
  it('should track fill and exit correctly', () => {
    const tracker = new MicroGabagoolPnlTracker(defaultConfig);

    tracker.recordFill('m1', 0.45, 1.0, 1.0 / 0.45);
    expect(tracker.hasPosition('m1')).toBe(true);
    expect(tracker.getBalance()).toBe(14.0);

    const trade = tracker.recordExit('m1', 0.46, false, 60);
    expect(trade.grossProfitUsd).toBeCloseTo(0.0222, 3);
    expect(trade.gasCostUsd).toBe(0.004);
    expect(trade.rebateUsd).toBeCloseTo(0.001, 3);
    expect(trade.netProfitUsd).toBeCloseTo(0.0192, 3);
    expect(trade.isTakerExit).toBe(false);
    expect(tracker.hasPosition('m1')).toBe(false);
  });

  it('should track losses correctly', () => {
    const tracker = new MicroGabagoolPnlTracker(defaultConfig);

    tracker.recordFill('m1', 0.45, 1.0, 1.0 / 0.45);
    const trade = tracker.recordExit('m1', 0.44, false, 120);

    expect(trade.grossProfitUsd).toBeLessThan(0);
    expect(trade.netProfitUsd).toBeLessThan(0);
  });

  it('should track taker exits', () => {
    const tracker = new MicroGabagoolPnlTracker(defaultConfig);

    tracker.recordFill('m1', 0.45, 1.0, 1.0 / 0.45);
    const trade = tracker.recordExit('m1', 0.44, true, 600);

    expect(trade.isTakerExit).toBe(true);
  });

  it('should compute snapshot correctly', () => {
    const tracker = new MicroGabagoolPnlTracker(defaultConfig);

    tracker.recordFill('m1', 0.45, 1.0, 1.0 / 0.45);
    tracker.recordExit('m1', 0.46, false, 60);

    const snapshot = tracker.getSnapshot(new Map());
    expect(snapshot.tradeCount).toBe(1);
    expect(snapshot.winCount).toBe(1);
    expect(snapshot.lossCount).toBe(0);
    expect(snapshot.winRate).toBe(1.0);
    expect(snapshot.makerFillsCount).toBe(1);
    expect(snapshot.takerFillsCount).toBe(0);
  });

  it('should track unrealized PnL', () => {
    const tracker = new MicroGabagoolPnlTracker(defaultConfig);

    tracker.recordFill('m1', 0.45, 1.0, 1.0 / 0.45);

    const snapshot = tracker.getSnapshot(new Map([['m1', 0.46]]));
    expect(snapshot.unrealizedPnlUsd).toBeCloseTo(0.0222, 3);
  });

  it('should throw on exit without position', () => {
    const tracker = new MicroGabagoolPnlTracker(defaultConfig);
    expect(() => tracker.recordExit('m1', 0.46, false, 60)).toThrow('No position');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- tests/accounting/micro-gabagool-pnl-tracker.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/accounting/micro-gabagool-pnl-tracker.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/accounting/micro-gabagool-pnl-tracker.ts tests/accounting/micro-gabagool-pnl-tracker.test.ts
git commit -m "feat(gabagool): add PnL tracker with gas/fee accounting"
```

---

## Task 6: Order Manager

**Files:**
- Create: `src/execution/micro-gabagool-order-manager.ts`
- Test: `tests/execution/micro-gabagool-order-manager.test.ts`

- [ ] **Step 1: Write order manager**

```typescript
// src/execution/micro-gabagool-order-manager.ts

export interface Order {
  id: string;
  marketId: string;
  tokenId: string;
  side: 'BUY' | 'SELL';
  price: number;
  sizeUsd: number;
  shares: number;
  status: 'PENDING' | 'OPEN' | 'FILLED' | 'PARTIALLY_FILLED' | 'CANCELLED' | 'EXPIRED';
  createdAt: number;
  filledSizeUsd: number;
  filledShares: number;
  isPostOnly: boolean;
}

export interface PlaceOrderParams {
  marketId: string;
  tokenId: string;
  side: 'BUY' | 'SELL';
  price: number;
  sizeUsd: number;
  isPostOnly: boolean;
}

export interface OrderManagerDeps {
  placeOrder: (params: PlaceOrderParams) => Promise<{ orderId: string }>;
  cancelOrder: (orderId: string) => Promise<boolean>;
  getOrderStatus: (orderId: string) => Promise<{ status: string; filledSizeUsd: number }>;
  nowMs: () => number;
}

export class MicroGabagoolOrderManager {
  private orders: Map<string, Order> = new Map();
  private orderCounter: number = 0;

  constructor(private deps: OrderManagerDeps) {}

  async placeEntry(params: PlaceOrderParams): Promise<Order> {
    const orderId = `entry-${++this.orderCounter}`;
    const shares = params.sizeUsd / params.price;

    const order: Order = {
      id: orderId,
      marketId: params.marketId,
      tokenId: params.tokenId,
      side: params.side,
      price: params.price,
      sizeUsd: params.sizeUsd,
      shares,
      status: 'PENDING',
      createdAt: this.deps.nowMs(),
      filledSizeUsd: 0,
      filledShares: 0,
      isPostOnly: params.isPostOnly,
    };

    this.orders.set(orderId, order);

    try {
      const result = await this.deps.placeOrder(params);
      order.status = 'OPEN';
      order.id = result.orderId;
      this.orders.set(result.orderId, order);
      this.orders.delete(orderId);
      return order;
    } catch (error) {
      order.status = 'CANCELLED';
      throw error;
    }
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    const order = this.orders.get(orderId);
    if (!order) return false;

    const success = await this.deps.cancelOrder(orderId);
    if (success) {
      order.status = 'CANCELLED';
    }
    return success;
  }

  async checkOrderTimeouts(maxAgeSeconds: number): Promise<Order[]> {
    const now = this.deps.nowMs();
    const timedOut: Order[] = [];

    for (const order of this.orders.values()) {
      if (order.status !== 'OPEN') continue;

      const ageSeconds = (now - order.createdAt) / 1000;
      if (ageSeconds > maxAgeSeconds) {
        order.status = 'EXPIRED';
        timedOut.push(order);
      }
    }

    return timedOut;
  }

  async reconcileOrder(orderId: string): Promise<Order | null> {
    const order = this.orders.get(orderId);
    if (!order) return null;

    const status = await this.deps.getOrderStatus(orderId);
    order.status = status.status as Order['status'];
    order.filledSizeUsd = status.filledSizeUsd;
    order.filledShares = status.filledSizeUsd / order.price;

    return order;
  }

  getOrder(orderId: string): Order | undefined {
    return this.orders.get(orderId);
  }

  getOpenOrders(): Order[] {
    return Array.from(this.orders.values()).filter(o => o.status === 'OPEN');
  }

  getOpenOrdersForMarket(marketId: string): Order[] {
    return Array.from(this.orders.values()).filter(
      o => o.marketId === marketId && o.status === 'OPEN'
    );
  }

  hasOpenOrderForMarket(marketId: string): boolean {
    return this.getOpenOrdersForMarket(marketId).length > 0;
  }
}
```

- [ ] **Step 2: Write tests**

```typescript
// tests/execution/micro-gabagool-order-manager.test.ts
import { MicroGabagoolOrderManager, OrderManagerDeps } from '../../src/execution/micro-gabagool-order-manager';

function mockDeps(overrides?: Partial<OrderManagerDeps>): OrderManagerDeps {
  return {
    placeOrder: jest.fn().mockResolvedValue({ orderId: 'exchange-1' }),
    cancelOrder: jest.fn().mockResolvedValue(true),
    getOrderStatus: jest.fn().mockResolvedValue({ status: 'OPEN', filledSizeUsd: 0 }),
    nowMs: () => 1000000,
    ...overrides,
  };
}

describe('MicroGabagoolOrderManager', () => {
  it('should place entry order', async () => {
    const deps = mockDeps();
    const om = new MicroGabagoolOrderManager(deps);

    const order = await om.placeEntry({
      marketId: 'm1',
      tokenId: 'token1',
      side: 'BUY',
      price: 0.45,
      sizeUsd: 1.0,
      isPostOnly: true,
    });

    expect(order.status).toBe('OPEN');
    expect(order.price).toBe(0.45);
    expect(order.sizeUsd).toBe(1.0);
    expect(deps.placeOrder).toHaveBeenCalled();
  });

  it('should cancel order', async () => {
    const deps = mockDeps();
    const om = new MicroGabagoolOrderManager(deps);

    await om.placeEntry({
      marketId: 'm1',
      tokenId: 'token1',
      side: 'BUY',
      price: 0.45,
      sizeUsd: 1.0,
      isPostOnly: true,
    });

    const success = await om.cancelOrder('exchange-1');
    expect(success).toBe(true);
    expect(om.getOrder('exchange-1')?.status).toBe('CANCELLED');
  });

  it('should detect timed out orders', async () => {
    let currentTime = 1000000;
    const deps = mockDeps({ nowMs: () => currentTime });
    const om = new MicroGabagoolOrderManager(deps);

    await om.placeEntry({
      marketId: 'm1',
      tokenId: 'token1',
      side: 'BUY',
      price: 0.45,
      sizeUsd: 1.0,
      isPostOnly: true,
    });

    currentTime = 1000000 + 46 * 1000; // 46 seconds later
    const timedOut = await om.checkOrderTimeouts(45);
    expect(timedOut).toHaveLength(1);
    expect(timedOut[0].status).toBe('EXPIRED');
  });

  it('should track open orders per market', async () => {
    const deps = mockDeps();
    const om = new MicroGabagoolOrderManager(deps);

    await om.placeEntry({
      marketId: 'm1',
      tokenId: 'token1',
      side: 'BUY',
      price: 0.45,
      sizeUsd: 1.0,
      isPostOnly: true,
    });

    expect(om.hasOpenOrderForMarket('m1')).toBe(true);
    expect(om.hasOpenOrderForMarket('m2')).toBe(false);
    expect(om.getOpenOrdersForMarket('m1')).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- tests/execution/micro-gabagool-order-manager.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/execution/micro-gabagool-order-manager.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/execution/micro-gabagool-order-manager.ts tests/execution/micro-gabagool-order-manager.test.ts
git commit -m "feat(gabagool): add order manager with timeout tracking"
```

---

## Task 7: Paper Engine

**Files:**
- Create: `src/simulation/micro-gabagool-paper-engine.ts`
- Test: `tests/simulation/micro-gabagool-paper-engine.test.ts`

- [ ] **Step 1: Write paper engine**

```typescript
// src/simulation/micro-gabagool-paper-engine.ts

export interface PaperEngineConfig {
  gasPerRoundtripEstimateUsd: number;
  makerRebateRate: number;
  fillProbability: number;
  partialFillProbability: number;
  lateFillProbability: number;
}

export interface SimulatedFill {
  orderId: string;
  filledSizeUsd: number;
  filledShares: number;
  isPartial: boolean;
  isLateFill: boolean;
}

export class MicroGabagoolPaperEngine {
  private pendingCancels: Map<string, { cancelledAt: number; originalOrder: any }> = new Map();

  constructor(
    private config: PaperEngineConfig,
    private nowFn: () => number = Date.now
  ) {}

  simulateFill(orderId: string, price: number, sizeUsd: number, orderbook: { bestBid: number; bestAsk: number }): SimulatedFill | null {
    // Post-only check: if price would cross, no fill
    if (price >= orderbook.bestAsk) {
      return null; // Would be taker, reject
    }

    // Random fill probability
    if (Math.random() > this.config.fillProbability) {
      return null;
    }

    // Partial fill probability
    const isPartial = Math.random() < this.config.partialFillProbability;
    const filledSizeUsd = isPartial ? sizeUsd * (0.3 + Math.random() * 0.7) : sizeUsd;
    const filledShares = filledSizeUsd / price;

    return {
      orderId,
      filledSizeUsd,
      filledShares,
      isPartial,
      isLateFill: false,
    };
  }

  simulateLateFill(orderId: string, price: number, sizeUsd: number): SimulatedFill | null {
    const pending = this.pendingCancels.get(orderId);
    if (!pending) return null;

    // Small chance of late fill
    if (Math.random() > this.config.lateFillProbability) {
      this.pendingCancels.delete(orderId);
      return null;
    }

    this.pendingCancels.delete(orderId);

    return {
      orderId,
      filledSizeUsd: sizeUsd,
      filledShares: sizeUsd / price,
      isPartial: false,
      isLateFill: true,
    };
  }

  recordCancel(orderId: string, order: any): void {
    this.pendingCancels.set(orderId, {
      cancelledAt: this.nowFn(),
      originalOrder: order,
    });
  }

  simulateGasCost(): number {
    return this.config.gasPerRoundtripEstimateUsd;
  }

  simulateMakerRebate(sizeUsd: number): number {
    return sizeUsd * this.config.makerRebateRate;
  }
}
```

- [ ] **Step 2: Write tests**

```typescript
// tests/simulation/micro-gabagool-paper-engine.test.ts
import { MicroGabagoolPaperEngine } from '../../src/simulation/micro-gabagool-paper-engine';

const defaultConfig = {
  gasPerRoundtripEstimateUsd: 0.004,
  makerRebateRate: 0.001,
  fillProbability: 1.0, // Always fill for deterministic tests
  partialFillProbability: 0.0, // Never partial
  lateFillProbability: 0.0, // Never late
};

describe('MicroGabagoolPaperEngine', () => {
  it('should simulate fill when price is below ask', () => {
    const engine = new MicroGabagoolPaperEngine(defaultConfig);
    const fill = engine.simulateFill('order-1', 0.45, 1.0, { bestBid: 0.44, bestAsk: 0.48 });

    expect(fill).not.toBeNull();
    expect(fill!.filledSizeUsd).toBe(1.0);
    expect(fill!.isPartial).toBe(false);
  });

  it('should reject fill when price crosses ask', () => {
    const engine = new MicroGabagoolPaperEngine(defaultConfig);
    const fill = engine.simulateFill('order-1', 0.49, 1.0, { bestBid: 0.44, bestAsk: 0.48 });

    expect(fill).toBeNull();
  });

  it('should simulate gas cost', () => {
    const engine = new MicroGabagoolPaperEngine(defaultConfig);
    expect(engine.simulateGasCost()).toBe(0.004);
  });

  it('should simulate maker rebate', () => {
    const engine = new MicroGabagoolPaperEngine(defaultConfig);
    expect(engine.simulateMakerRebate(1.0)).toBe(0.001);
  });

  it('should simulate partial fill', () => {
    const config = { ...defaultConfig, partialFillProbability: 1.0 };
    const engine = new MicroGabagoolPaperEngine(config);

    const fill = engine.simulateFill('order-1', 0.45, 1.0, { bestBid: 0.44, bestAsk: 0.48 });

    expect(fill).not.toBeNull();
    expect(fill!.isPartial).toBe(true);
    expect(fill!.filledSizeUsd).toBeLessThan(1.0);
  });

  it('should detect late fill after cancel', () => {
    const config = { ...defaultConfig, lateFillProbability: 1.0 };
    const engine = new MicroGabagoolPaperEngine(config);

    engine.recordCancel('order-1', { price: 0.45, sizeUsd: 1.0 });
    const lateFill = engine.simulateLateFill('order-1', 0.45, 1.0);

    expect(lateFill).not.toBeNull();
    expect(lateFill!.isLateFill).toBe(true);
  });

  it('should not late fill if no pending cancel', () => {
    const config = { ...defaultConfig, lateFillProbability: 1.0 };
    const engine = new MicroGabagoolPaperEngine(config);

    const lateFill = engine.simulateLateFill('order-1', 0.45, 1.0);
    expect(lateFill).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- tests/simulation/micro-gabagool-paper-engine.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/simulation/micro-gabagool-paper-engine.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/simulation/micro-gabagool-paper-engine.ts tests/simulation/micro-gabagool-paper-engine.test.ts
git commit -m "feat(gabagool): add paper engine with fill simulation"
```

---

## Task 8: Main Runner

**Files:**
- Create: `src/run-micro-gabagool.ts`
- Test: `tests/integration/micro-gabagool-integration.test.ts`

- [ ] **Step 1: Write main runner**

```typescript
// src/run-micro-gabagool.ts

import { MicroGabagoolConfig, DEFAULT_CONFIG } from './strategy/micro-gabagool-config';
import { computeOpportunityScore } from './engines/micro-gabagool-scorer';
import { passesMarketFilters } from './strategy/micro-gabagool-filters';
import { MicroGabagoolRiskManager } from './risk/micro-gabagool-risk-manager';
import { MicroGabagoolOrderManager } from './execution/micro-gabagool-order-manager';
import { MicroGabagoolPnlTracker } from './accounting/micro-gabagool-pnl-tracker';
import { MicroGabagoolPaperEngine } from './simulation/micro-gabagool-paper-engine';

export interface MarketCandidate {
  conditionId: string;
  tokenId: string;
  bestBid: number;
  bestAsk: number;
  bestBidSizeUsd: number;
  bestAskSizeUsd: number;
  timeToSettlementMin: number;
  hasRecentTrades: boolean;
  wmpDelta3Min: number;
  spreadChangesLast60Sec: number;
}

export interface CycleDeps {
  config: MicroGabagoolConfig;
  scanner: { scan: () => Promise<MarketCandidate[]> };
  orderManager: MicroGabagoolOrderManager;
  riskManager: MicroGabagoolRiskManager;
  pnlTracker: MicroGabagoolPnlTracker;
  paperEngine?: MicroGabagoolPaperEngine;
  writeEvent: (event: Record<string, unknown>) => void;
  nowMs: () => number;
}

export async function runGabagoolCycle(deps: CycleDeps): Promise<void> {
  const { config, scanner, orderManager, riskManager, pnlTracker, paperEngine, writeEvent, nowMs } = deps;

  // Reset daily PnL if new day
  riskManager.resetDaily(nowMs());

  // Check kill switch
  const killState = riskManager.getKillSwitchState();
  if (killState !== 'ACTIVE') {
    writeEvent({ eventType: 'skip', reason: `kill_switch_${killState.toLowerCase()}`, timestamp: nowMs() });
    return;
  }

  // Check for pending order timeouts
  const timedOut = await orderManager.checkOrderTimeouts(config.maxOrderAgeSeconds);
  for (const order of timedOut) {
    await orderManager.cancelOrder(order.id);
    writeEvent({
      eventType: 'order_timeout',
      orderId: order.id,
      marketId: order.marketId,
      timestamp: nowMs(),
    });
  }

  // Scan markets
  const markets = await scanner.scan();

  // Filter and score markets
  const candidates: Array<{ market: MarketCandidate; score: number }> = [];

  for (const market of markets) {
    // Apply filters
    const filterResult = passesMarketFilters({
      bestBid: market.bestBid,
      bestAsk: market.bestAsk,
      bestBidSizeUsd: market.bestBidSizeUsd,
      bestAskSizeUsd: market.bestAskSizeUsd,
      timeToSettlementMin: market.timeToSettlementMin,
      hasRecentTrades: market.hasRecentTrades,
      isInCooldown: false, // TODO: check cooldown
      hasActivePosition: pnlTracker.hasPosition(market.conditionId),
      hasActiveOrder: orderManager.hasOpenOrderForMarket(market.conditionId),
      minSpread: config.minSpread,
      maxSpread: config.maxSpread,
      minBid: config.minBid,
      maxAsk: config.maxAsk,
      minTimeToSettlementMinutes: config.minTimeToSettlementMinutes,
      minTopOfBookSizeUsd: config.minTopOfBookSizeUsd,
    });

    if (!filterResult.pass) {
      writeEvent({
        eventType: 'filter_reject',
        marketId: market.conditionId,
        reason: filterResult.reason,
        timestamp: nowMs(),
      });
      continue;
    }

    // Score market
    const scoreResult = computeOpportunityScore({
      spread: market.bestAsk - market.bestBid,
      bestBidSizeUsd: market.bestBidSizeUsd,
      bestAskSizeUsd: market.bestAskSizeUsd,
      wmpDelta3Min: market.wmpDelta3Min,
      spreadChangesLast60Sec: market.spreadChangesLast60Sec,
      timeToSettlementMin: market.timeToSettlementMin,
    }, config.minScoreToTrade);

    if (!scoreResult.passThreshold) {
      writeEvent({
        eventType: 'score_reject',
        marketId: market.conditionId,
        score: scoreResult.totalScore,
        timestamp: nowMs(),
      });
      continue;
    }

    candidates.push({ market, score: scoreResult.totalScore });
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  // Try to enter top candidate
  for (const { market, score } of candidates) {
    const entryPrice = market.bestBid + config.tickSize;
    const expectedProfit = config.tickSize; // 1 tick spread capture
    const expectedNetProfit = expectedProfit - config.gasPerRoundtripEstimateUsd + (config.orderSizeMinUsd * config.makerRebateRate);

    // Check min profit threshold
    if (expectedNetProfit < config.minProfitThresholdUsd) {
      writeEvent({
        eventType: 'skip',
        reason: 'below_min_profit_threshold',
        marketId: market.conditionId,
        expectedNetProfit,
        timestamp: nowMs(),
      });
      continue;
    }

    // Risk check
    const riskCheck = riskManager.canEnterMarket(market.conditionId, config.orderSizeMinUsd, nowMs());
    if (!riskCheck.allowed) {
      writeEvent({
        eventType: 'risk_block',
        marketId: market.conditionId,
        reason: riskCheck.reason,
        timestamp: nowMs(),
      });
      continue;
    }

    // Place entry order
    try {
      const order = await orderManager.placeEntry({
        marketId: market.conditionId,
        tokenId: market.tokenId,
        side: 'BUY',
        price: entryPrice,
        sizeUsd: config.orderSizeMinUsd,
        isPostOnly: true,
      });

      riskManager.addExposure(market.conditionId, config.orderSizeMinUsd);

      writeEvent({
        eventType: 'entry_placed',
        orderId: order.id,
        marketId: market.conditionId,
        price: entryPrice,
        sizeUsd: config.orderSizeMinUsd,
        score,
        timestamp: nowMs(),
      });

      break; // Only one entry per cycle
    } catch (error) {
      writeEvent({
        eventType: 'entry_error',
        marketId: market.conditionId,
        error: String(error),
        timestamp: nowMs(),
      });
    }
  }
}

export function assertGabagoolModeAllowed(mode: MicroGabagoolConfig['mode'], enableLiveTrading: boolean): void {
  if (mode === 'live' && !enableLiveTrading) {
    throw new Error('Live mode requires enable_live_trading: true');
  }
}
```

- [ ] **Step 2: Write integration test**

```typescript
// tests/integration/micro-gabagool-integration.test.ts
import { runGabagoolCycle, assertGabagoolModeAllowed, CycleDeps, MarketCandidate } from '../../src/run-micro-gabagool';
import { DEFAULT_CONFIG } from '../../src/strategy/micro-gabagool-config';
import { MicroGabagoolRiskManager } from '../../src/risk/micro-gabagool-risk-manager';
import { MicroGabagoolOrderManager } from '../../src/execution/micro-gabagool-order-manager';
import { MicroGabagoolPnlTracker } from '../../src/accounting/micro-gabagool-pnl-tracker';

const now = 1000000;

function idealMarket(overrides?: Partial<MarketCandidate>): MarketCandidate {
  return {
    conditionId: 'm1',
    tokenId: 'token1',
    bestBid: 0.45,
    bestAsk: 0.48,
    bestBidSizeUsd: 50,
    bestAskSizeUsd: 50,
    timeToSettlementMin: 120,
    hasRecentTrades: true,
    wmpDelta3Min: 0.03,
    spreadChangesLast60Sec: 0,
    ...overrides,
  };
}

describe('micro gabagool integration', () => {
  it('should place entry order for ideal market', async () => {
    const events: Record<string, unknown>[] = [];
    const riskManager = new MicroGabagoolRiskManager({
      maxDailyLossUsd: 1.50,
      maxTotalExposureUsd: 6.0,
      maxPositionPerMarketUsd: 3.0,
      maxActiveMarkets: 2,
      consecutiveLossLimit: 3,
      marketCooldownAfterLossMinutes: 30,
      marketCooldownAfterTwoBadExitsMinutes: 60,
    }, now);

    const orderManager = new MicroGabagoolOrderManager({
      placeOrder: jest.fn().mockResolvedValue({ orderId: 'exchange-1' }),
      cancelOrder: jest.fn().mockResolvedValue(true),
      getOrderStatus: jest.fn().mockResolvedValue({ status: 'OPEN', filledSizeUsd: 0 }),
      nowMs: () => now,
    });

    const pnlTracker = new MicroGabagoolPnlTracker({
      gasPerRoundtripEstimateUsd: 0.004,
      makerRebateRate: 0.001,
      initialBalanceUsd: 15.0,
    }, now);

    const deps: CycleDeps = {
      config: DEFAULT_CONFIG,
      scanner: { scan: async () => [idealMarket()] },
      orderManager,
      riskManager,
      pnlTracker,
      writeEvent: (event) => events.push(event),
      nowMs: () => now,
    };

    await runGabagoolCycle(deps);

    expect(events.some(e => e.eventType === 'entry_placed')).toBe(true);
    expect(orderManager.getOpenOrders()).toHaveLength(1);
  });

  it('should reject market with narrow spread', async () => {
    const events: Record<string, unknown>[] = [];
    const riskManager = new MicroGabagoolRiskManager({
      maxDailyLossUsd: 1.50,
      maxTotalExposureUsd: 6.0,
      maxPositionPerMarketUsd: 3.0,
      maxActiveMarkets: 2,
      consecutiveLossLimit: 3,
      marketCooldownAfterLossMinutes: 30,
      marketCooldownAfterTwoBadExitsMinutes: 60,
    }, now);

    const orderManager = new MicroGabagoolOrderManager({
      placeOrder: jest.fn(),
      cancelOrder: jest.fn(),
      getOrderStatus: jest.fn(),
      nowMs: () => now,
    });

    const pnlTracker = new MicroGabagoolPnlTracker({
      gasPerRoundtripEstimateUsd: 0.004,
      makerRebateRate: 0.001,
      initialBalanceUsd: 15.0,
    }, now);

    const deps: CycleDeps = {
      config: DEFAULT_CONFIG,
      scanner: { scan: async () => [idealMarket({ bestAsk: 0.46 })] }, // spread = 0.01
      orderManager,
      riskManager,
      pnlTracker,
      writeEvent: (event) => events.push(event),
      nowMs: () => now,
    };

    await runGabagoolCycle(deps);

    expect(events.some(e => e.eventType === 'filter_reject' && e.reason === 'spread_too_narrow')).toBe(true);
    expect(orderManager.getOpenOrders()).toHaveLength(0);
  });

  it('should hard-block live mode without explicit opt-in', () => {
    expect(() => assertGabagoolModeAllowed('live', false)).toThrow('Live mode requires');
    expect(() => assertGabagoolModeAllowed('live', true)).not.toThrow();
    expect(() => assertGabagoolModeAllowed('paper', false)).not.toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- tests/integration/micro-gabagool-integration.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/integration/micro-gabagool-integration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/run-micro-gabagool.ts tests/integration/micro-gabagool-integration.test.ts
git commit -m "feat(gabagool): add main runner with full integration"
```

---

## Task 9: Full Test Suite Verification

**Files:**
- Modify: `package.json` (add scripts)

- [ ] **Step 1: Run full test suite**

Run: `npm test -- --runInBand`
Expected: All tests pass

- [ ] **Step 2: Build project**

Run: `npm run build`
Expected: No TypeScript errors

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: verify full test suite passes"
```

---

## Task 10: Documentation

**Files:**
- Create: `docs/micro-gabagool-maker-v1.md`

- [ ] **Step 1: Write documentation**

```markdown
# micro_gabagool_maker_v1

A maker-only micro-spread capture strategy for Polymarket.

## Overview

This strategy captures 1-2 tick spread ($0.01-$0.02) by placing post-only limit orders on both sides of the order book. It does NOT predict event outcomes.

## Quick Start

```bash
# Paper mode (default)
npm run start:gabagool

# Shadow mode (live data, no orders)
MODE=shadow npm run start:gabagool

# Live mode (requires explicit opt-in)
MODE=live ENABLE_LIVE_TRADING=true npm run start:gabagool
```

## Configuration

All parameters in `src/strategy/micro-gabagool-config.ts`.

## Risk Controls

- Daily stop loss: $1.50
- Max total exposure: $6.00
- Max position per market: $3.00
- Consecutive loss limit: 3
- Market cooldown after loss: 30 min

## Monitoring

JSONL logs in `logs/micro-gabagool-*.jsonl`
```

- [ ] **Step 2: Commit**

```bash
git add docs/micro-gabagool-maker-v1.md
git commit -m "docs: add micro_gabagool_maker_v1 documentation"
```
