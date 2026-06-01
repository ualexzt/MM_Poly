# micro_gabagool_maker_v1 — Design Specification

**Version:** 1.0  
**Date:** 2026-06-01  
**Status:** APPROVED  

---

## 1. Overview

### Problem
The existing latency arb strategy requires BTC price movement ≥0.5% to generate signals. In 2 hours of soak testing, zero would-orders were generated because BTC was stable. The strategy is fundamentally limited to predicting directional moves.

### Solution
Replace with `micro_gabagool_maker_v1` — a market-making strategy that captures micro-spread inefficiencies in Polymarket order books. Unlike latency arb (directional betting), this strategy:
- Provides liquidity (maker/post-only orders)
- Captures 1-2 tick spread ($0.01-$0.02)
- Works on ANY Polymarket market (not just BTC 15m)
- Does NOT predict event outcomes

### Success Criteria
- Fill rate: 60-80%
- Net profit per cycle: $0.005-$0.015 (after gas)
- Daily target: $0.30-$0.75 (40-100 successful cycles)
- Zero taker entries (except emergency force exit)
- Zero inventory accumulation
- Proper risk controls (daily stop loss, consecutive loss limit)

---

## 2. Architecture

### Module Structure
```
src/
├── engines/
│   └── micro-gabagool-scorer.ts      # Pure: score markets 0-10
├── strategy/
│   └── micro-gabagool-filters.ts     # Pure: market eligibility filters
├── risk/
│   └── micro-gabagool-risk-manager.ts # Stateful: pre-trade checks, kill switch
├── execution/
│   └── micro-gabagool-order-manager.ts # Stateful: order lifecycle
├── simulation/
│   └── micro-gabagool-paper-engine.ts  # Paper mode simulation
├── accounting/
│   └── micro-gabagool-pnl-tracker.ts   # P&L tracking with gas/fees
└── run-micro-gabagool.ts              # Main runner
```

### Data Flow
```
Market Scanner (Gamma API)
    ↓
Filter Markets (pure function)
    ↓
Score Markets (pure function)
    ↓
Risk Manager (stateful check)
    ↓
Entry Engine (post-only BUY)
    ↓
Wait for Fill (WebSocket + polling)
    ↓
Exit Engine (post-only SELL)
    ↓
PnL Tracker (realized + gas + fees)
```

---

## 3. Scoring Model

### Formula
```
Score = 0.35 × S_spread + 0.25 × S_liq + 0.20 × S_vol + 0.10 × S_ob + 0.10 × S_settlement
```

**Threshold:** Score ≥ 7.5 to trade

### Components

#### 3.1 Spread Score (S_spread)
| Spread Range | Score |
|---|---|
| 0.02 - 0.03 | 10 (ideal) |
| 0.03 - 0.04 | 8 (acceptable) |
| 0.04 - 0.05 | 5 (marginal) |
| < 0.02 or > 0.05 | 0 (reject) |

#### 3.2 Liquidity Score (S_liq)
Based on min(bestBidSizeUsd, bestAskSizeUsd):
- ≥ 10.0 USDC → 10
- 5.0 - 10.0 USDC → linear scale
- < 5.0 USDC → 0

#### 3.3 Volatility Score (S_vol)
Based on WMP (Weighted Mid-Price) delta over 3 minutes:
```
WMP = (P_bid × V_ask + P_ask × V_bid) / (V_bid + V_ask)
```
- ΔWMP 0.01-0.05 → 10 (working volatility)
- ΔWMP < 0.01 → 5 (too quiet, stuck risk)
- ΔWMP > 0.05 → 0 (toxic, too volatile)

#### 3.4 Orderbook Stability Score (S_ob)
Based on spread changes and depth disappearance over 60 seconds:
- Stable, no flickering → 10
- 1-2 sharp spread expansions → 5
- Frequent bid/ask disappearance → 0

#### 3.5 Settlement Score (S_settlement)
- ≥ 60 min to settlement → 10
- 15-60 min → 6
- < 15 min → 0 (filter reject)

---

## 4. Risk Management

### 4.1 Pre-Trade Checks
Entry allowed ONLY if ALL conditions pass:
```
dailyPnl > -1.50 USDC
totalExposure + orderSize <= 6.00 USDC
consecutiveLosses < 3
activeMarkets < 2
activeEntriesInMarket == 0
marketExposure + orderSize <= 3.00 USDC
```

### 4.2 Kill Switch Conditions
| Trigger | Action |
|---|---|
| Unrealized loss ≤ -3 ticks | Block new entries, force defensive exit |
| Daily PnL ≤ -1.50 USDC | Stop strategy until 00:00 UTC or manual unlock |
| 3 consecutive losses | Stop strategy until manual review |
| 2 bad exits in same market | Cooldown market 60 min |
| 4+ API failures | Enter safe mode |
| Orderbook desync after reconcile | Enter safe mode |

### 4.3 Cooldown Management
- After loss in market → cooldown 30 min
- After 2 bad exits in market → cooldown 60 min
- After stuck position (>300 sec) → cooldown 30 min

---

## 5. Order Lifecycle

### 5.1 Entry
1. Place post-only limit BUY at `best_bid + 1 tick`
2. Start 45-second timer
3. If not filled → cancel → re-score → reprice or skip
4. If filled → proceed to exit

### 5.2 Exit
1. Place post-only limit SELL at `entry_price + 1 tick` (or +2 if spread allows)
2. Start 300-second timer
3. If filled → record profit, done
4. If not filled → enter defensive exit mode

### 5.3 Defensive Exit (after 300 sec)
1. Cancel old exit order
2. Reprice at `entry_price` or `entry_price + 1 tick`
3. Start 600-second force exit timer
4. If still not filled → try maker at `best_bid - 1 tick`
5. If 60 sec later still not filled → FORCE TAKER EXIT (exception)

---

## 6. Platform Specifications

### Tick Size
- Minimum price step: $0.01
- All "1 tick" references = $0.01

### Minimum Order Size
- $1.00 USDC (orders below this are rejected by CLOB)

### Fees
| Type | Fee |
|---|---|
| Maker (post-only) | ~0% or small rebate |
| Taker | ~1-2% |

### Gas (Polygon)
| Action | Estimated Cost |
|---|---|
| Placement (off-chain) | ~$0 |
| Settlement (on-chain) | ~$0.001-0.005 |
| Cancel (if on-chain) | ~$0.001-0.003 |

### Breakeven Calculation
```
Gross profit (1 tick, $1.00 order):    $0.010
Gas (round-trip estimate):            -$0.004
Maker fee:                            -$0.000
Maker rebate:                         +$0.001
────────────────────────────────────────────
Net profit per cycle:                 ~$0.007
```

---

## 7. Paper Mode

Paper mode simulates:
- Fill probability based on orderbook position
- Partial fills
- Late fills after cancel
- Gas costs ($0.004 per round-trip)
- Maker rebate (+$0.001 per fill)
- Random API errors (testing retry logic)

LIVE mode requires explicit `enable_live_trading: true` flag.

---

## 8. API Resilience

### Retry Logic
```
Attempt 1: immediate
Attempt 2: after 1 second
Attempt 3: after 2 seconds
Attempt 4: after 4 seconds
After 4 failures → safe mode
```

### Error Classification
- **Network error** (timeout, connection reset): retry
- **4xx exchange error** (invalid order, insufficient balance): no retry, log and cancel
- **5xx server error**: retry with backoff
- **429 rate limit**: wait for Retry-After header

### Reconnect + Reconciliation
On reconnect:
1. Stop all new entries
2. Fetch open orders and positions from exchange
3. Compare with local state
4. Cancel orphaned orders
5. Add missing orders/positions
6. Only then allow new entries

---

## 9. Monitoring Metrics

### P&L
- realized_pnl, unrealized_pnl, daily_pnl
- gross_pnl (before gas/fees), net_pnl (after)
- gas_costs_total, fees_paid_total, rebates_received_total

### Execution
- entries_count, exits_count, fill_rate
- avg_hold_time_seconds, avg_spread_captured
- maker_fills_count, taker_fills_count (should be 0)
- force_taker_exits_count

### Orders
- rejected_orders, canceled_orders, stale_orders
- late_fills_detected, partial_fills_count

### Risk
- current_total_exposure, exposure_per_market
- consecutive_losses, markets_in_cooldown
- stuck_positions_count

### System
- api_errors_count, reconnects_count
- safe_mode_activations, current_mode

### Breakeven
- cycles_to_breakeven_today
- avg_net_profit_per_cycle

---

## 10. Config

```yaml
mode: paper
enable_live_trading: false

initial_balance: 15.0
active_trading_capital: 10.0
reserve_balance: 5.0
gas_reserve: 0.5

order_size_min: 1.0
order_size_max: 1.5
max_position_per_market: 3.0
max_total_exposure: 6.0
max_active_markets: 2

max_order_age_seconds: 45
max_position_age_seconds: 300
defensive_exit_timeout_seconds: 600

max_daily_loss: 1.50
daily_profit_target_min: 0.30
daily_profit_target_max: 0.75
consecutive_loss_limit: 3

tick_size: 0.01
min_profit_threshold: 0.005
gas_per_roundtrip_estimate: 0.004
maker_rebate_rate: 0.001

min_spread: 0.02
max_spread: 0.05
min_bid: 0.08
max_ask: 0.92
min_time_to_settlement_minutes: 15
min_top_of_book_size: 10.0
recent_trade_window_minutes: 5

min_score_to_trade: 7.5

market_cooldown_after_loss_minutes: 30
market_cooldown_after_two_bad_exits_minutes: 60

api_max_retries: 4
api_retry_base_delay_seconds: 1
api_retry_max_delay_seconds: 8
reconcile_on_reconnect: true
```

---

## 11. Acceptance Criteria

### Trading Logic
- [ ] No cross-market arbitrage
- [ ] No delta-neutral hedging
- [ ] No taker entries (except force exit)
- [ ] Post-only maker entries
- [ ] Cancel/reprice support
- [ ] Partial fill support
- [ ] max_order_age timeout
- [ ] max_position_age + defensive_exit_timeout
- [ ] Force exit after exhausting maker attempts

### Risk Controls
- [ ] Daily stop loss
- [ ] Max market exposure
- [ ] Max total exposure
- [ ] Cooldown after problematic market
- [ ] Stop after N consecutive losses
- [ ] min_profit_threshold check before entry

### Platform Awareness
- [ ] Tick size ($0.01)
- [ ] Gas in profit calculation
- [ ] Fees/rebate in profit calculation
- [ ] State reconciliation after reconnect
- [ ] Late fill detection

### Resilience
- [ ] Retry with backoff for API errors
- [ ] Reconnect + reconciliation logic
- [ ] Safe mode on persistent failures
- [ ] Network vs exchange error classification

### Infrastructure
- [ ] Paper mode
- [ ] LIVE mode requires explicit opt-in
- [ ] Paper mode simulates gas and fees
- [ ] All risk parameters in config
- [ ] Default parameters safe for 15 USDC
- [ ] Detailed decision logging

---

## 12. Expected Behavior

For 15 USDC balance:
- Normal daily target: $0.30-$0.75
- Expected net profit per cycle: $0.005-$0.015
- Expected cycles per day: 40-100
- Expected fill rate: 60-80%

Success criteria (NOT profit size):
- No taker entries
- No inventory accumulation
- No stuck positions
- Fast cancel/reprice
- Proper position closure
- Stop on risk threshold exceeded
- Correct net P&L after gas/fees
- API error resilience
