# micro_gabagool_maker_v1

A maker-only micro-spread capture strategy for Polymarket.

## Overview

This strategy captures 1-2 tick spread ($0.01-$0.02) by placing post-only limit orders. It does NOT predict event outcomes — it earns profit from micro-inefficiencies in the order book.

**Key principles:**
- Maker-only (post-only) entries
- No directional betting
- No cross-market arbitrage
- No delta-neutral hedging
- Strict risk controls for small balances ($15 USDC)

## Quick Start

```bash
# Live-data paper mode (default, safe; no real orders)
npm run start:gabagool

# Optional API scan controls
GABAGOOL_SCAN_INTERVAL_MS=30000 GABAGOOL_MAX_MARKETS_PER_SCAN=100 npm run start:gabagool

# Live mode is fail-closed and still has no real order submitter in this MVP.
# Do not use until a separate live-order implementation is designed and reviewed.
MODE=live ENABLE_LIVE_TRADING=true npm run start:gabagool
```

The current live-data MVP uses Gamma + CLOB reads only. It emits would-trade JSONL events and uses a simulated order manager; it never submits real Polymarket orders.

## Architecture

```
src/
├── engines/
│   └── micro-gabagool-scorer.ts         # Pure: score markets 0-10
├── data/
│   └── micro-gabagool-clob-orderbook-client.ts # CLOB top-of-book adapter
├── strategy/
│   ├── gamma-micro-gabagool-scanner.ts  # Gamma + CLOB market scanner
│   ├── micro-gabagool-rolling-stats.ts  # WMP/spread-change rolling stats
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
```

## Scoring Model

Markets are scored 0-10 using weighted components:

| Component | Weight | Ideal | Reject |
|-----------|--------|-------|--------|
| Spread | 35% | 0.02-0.03 | <0.02 or >0.05 |
| Liquidity | 25% | ≥10 USDC | <5 USDC |
| Volatility | 20% | 0.01-0.05 ΔWMP | >0.05 (toxic) |
| Orderbook Stability | 10% | Stable | Flickering |
| Settlement | 10% | ≥60 min | <15 min |

**Threshold:** Score ≥ 7.5 to trade

## Risk Controls

| Control | Limit |
|---------|-------|
| Daily stop loss | $1.50 |
| Max total exposure | $6.00 |
| Max position per market | $3.00 |
| Max active markets | 2 |
| Consecutive loss limit | 3 |
| Market cooldown after loss | 30 min |
| Market cooldown after 2 bad exits | 60 min |

## Order Lifecycle

### Entry
1. Place post-only limit BUY at `best_bid + 1 tick`
2. Start 45-second timer
3. If not filled → cancel → re-score → reprice or skip
4. If filled → proceed to exit

### Exit
1. Place post-only limit SELL at `entry_price + 1 tick` (or +2 if spread allows)
2. Start 300-second timer
3. If filled → record profit, done
4. If not filled → enter defensive exit mode

### Defensive Exit (after 300 sec)
1. Cancel old exit order
2. Reprice at `entry_price` or `entry_price + 1 tick`
3. Start 600-second force exit timer
4. If still not filled → try maker at `best_bid - 1 tick`
5. If 60 sec later still not filled → FORCE TAKER EXIT (exception)

## Live Data Runner

`npm run start:gabagool` runs `src/run-micro-gabagool.ts` and wires:

```text
Gamma active markets
  -> CLOB YES-token orderbooks
  -> rolling WMP/spread stats
  -> filters + scorer + risk manager
  -> simulated order manager / paper engine
  -> JSONL logs
```

Environment variables:

| Variable | Default | Notes |
|----------|---------|-------|
| `MODE` | `paper` | Only `live` changes mode; any other value is treated as safe paper mode. |
| `ENABLE_LIVE_TRADING` | `false` | Must be exactly `true` for `MODE=live`; live mode still has no real submitter in this MVP. |
| `GABAGOOL_SCAN_INTERVAL_MS` | `30000` | Invalid or non-positive values fall back to default. |
| `GABAGOOL_MAX_MARKETS_PER_SCAN` | `100` | Gamma page size / scan cap; invalid or non-positive values fall back to default. |
| `GAMMA_API_BASE_URL` | `https://gamma-api.polymarket.com` | Trailing slash is accepted. |
| `CLOB_API_BASE_URL` | `https://clob.polymarket.com` | Trailing slash is accepted. |
| `GABAGOOL_LOG_PATH` | `logs/micro-gabagool-YYYY-MM-DD.jsonl` | UTC date; parent directory is created automatically. |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | unset | Optional startup notification only. Failures are logged and do not stop the loop. |

## Configuration

Trading/risk parameters live in `src/strategy/micro-gabagool-config.ts`:

```typescript
const DEFAULT_CONFIG: MicroGabagoolConfig = {
  mode: 'paper',
  enableLiveTrading: false,
  
  initialBalanceUsd: 15.0,
  activeTradingCapitalUsd: 10.0,
  reserveBalanceUsd: 5.0,
  
  orderSizeMinUsd: 1.0,
  orderSizeMaxUsd: 1.5,
  maxPositionPerMarketUsd: 3.0,
  maxTotalExposureUsd: 6.0,
  maxActiveMarkets: 2,
  
  maxDailyLossUsd: 1.50,
  consecutiveLossLimit: 3,
  
  minSpread: 0.02,
  maxSpread: 0.05,
  minBid: 0.08,
  maxAsk: 0.92,
  minTimeToSettlementMinutes: 15,
  minTopOfBookSizeUsd: 10.0,
  
  minScoreToTrade: 7.5,
};
```

## Expected Performance

For 15 USDC balance:
- Daily target: $0.30-$0.75
- Net profit per cycle: $0.005-$0.015 (after gas)
- Expected cycles per day: 40-100
- Expected fill rate: 60-80%

## Success Criteria

- ✅ No taker entries (except emergency force exit)
- ✅ No inventory accumulation
- ✅ No stuck positions
- ✅ Fast cancel/reprice
- ✅ Proper position closure
- ✅ Stop on risk threshold exceeded
- ✅ Correct net P&L after gas/fees
- ✅ API error resilience

## Testing

```bash
# Run gabagool tests only
npm test -- tests/strategy/micro-gabagool-*.test.ts tests/engines/micro-gabagool-*.test.ts tests/risk/micro-gabagool-*.test.ts tests/accounting/micro-gabagool-*.test.ts tests/execution/micro-gabagool-*.test.ts tests/simulation/micro-gabagool-*.test.ts tests/integration/micro-gabagool-*.test.ts

# Run all tests
npm test
```

## Monitoring

JSONL logs in `logs/micro-gabagool-*.jsonl` with one JSON object per line. Current runner events include:
- `startup` — process started and runtime mode recorded
- `skip` — no candidates / no valid entries / kill-switch safe mode
- `filter_reject` — market rejected by filter
- `score_reject` — market rejected by score
- `risk_block` — entry blocked by risk manager
- `entry_placed` — would-place / simulated entry order
- `entry_error` — simulated entry placement failed
- `order_timeout` — order timed out
- `cycle_error` — scan or cycle failed; process stays alive for next interval

## Platform Notes

- **Tick size:** $0.01 (minimum price step)
- **Minimum order:** $1.00 USDC
- **Maker fee:** ~0% (or small rebate)
- **Gas (Polygon):** ~$0.001-0.005 per settlement
- **Breakeven:** ~$0.007 net profit per successful cycle
