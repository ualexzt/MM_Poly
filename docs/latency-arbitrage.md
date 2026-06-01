# Latency Arbitrage Strategy

## Overview

Latency Arbitrage compares real-time BTC price momentum from Binance with Polymarket BTC 15-minute Up/Down market prices.

**Current production-safe status:** live-like shadow only. The runner discovers BTC 15m markets, computes would-live post-only orders, tracks hypothetical positions, and writes JSONL events for soak analysis. It **does not submit real orders**. `MODE=small_live` is explicitly blocked for latency-arb until a separate live phase is designed, reviewed, and approved.

## Architecture

```text
BinanceWsFeed
  -> MomentumEngine
  -> BTC 15m Gamma market selector
  -> CLOB order book snapshot builder
  -> analyzeDivergence
  -> LatencyArbShadowExecutor
  -> JsonlEventWriter
  -> LatencyArbPositionTracker
```

### Components

| Component | Location | Purpose |
|-----------|----------|---------|
| **BinanceWsFeed** | `src/data/binance-ws-feed.ts` | Streams BTC price updates from Binance WebSocket |
| **MomentumEngine** | `src/engines/momentum-engine.ts` | Detects directional price moves |
| **DivergenceEngine** | `src/engines/divergence-engine.ts` | Pure function comparing momentum-implied probability with market prices |
| **Market selector** | `src/strategy/latency-arb-market-selector.ts` | Selects active BTC 15m Up/Down markets from Gamma |
| **Orderbook snapshot** | `src/strategy/latency-arb-orderbook.ts` | Builds validated YES/NO execution snapshots |
| **Shadow executor** | `src/simulation/latency-arb-shadow-executor.ts` | Records post-only would-orders; never submits live orders |
| **Position tracker** | `src/simulation/latency-arb-position-tracker.ts` | Tracks hypothetical fills, mark-to-market, and resolution PnL |
| **JSONL writer** | `src/accounting/jsonl-event-writer.ts` | Appends raw soak events to `logs/` |

## How It Works

1. **Price feed**: streams Binance BTC kline updates.
2. **Momentum detection**: maintains a rolling price window and computes price change, volume confirmation, and EMA alignment.
3. **Market discovery**: fetches Gamma markets and selects active BTC 15m Up/Down markets with YES/NO token IDs.
4. **Order book snapshot**: fetches CLOB books for YES and NO tokens, rejecting stale, invalid, or too-wide books.
5. **Divergence calculation**: compares momentum-implied probability with Polymarket ask prices.
6. **Would-live order generation**: writes a post-only limit order event using maker-side price, plus taker comparison stats.
7. **Hypothetical tracking**: pending maker orders can become hypothetical positions only after simulated latency and conservative cross-through. Positions are marked to market and resolved when outcome data is available.

## Event Log

Raw events are written as JSONL:

```text
logs/latency-arb-orders-YYYY-MM-DD.jsonl
```

Event types include:

- `signal`
- `skip`
- `would_place_order`
- `position_opened`
- `mark_to_market`
- `position_resolved`
- `runtime_stats`

## Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `LATENCY_ARB_ENABLED` | `false` | Enable shadow runner |
| `MODE` | `paper` | `paper` or `shadow`; `small_live` is blocked |
| `BINANCE_WS_URL` | `wss://stream.binance.com:9443` | Binance WS base URL |
| `BINANCE_SYMBOLS` | `btcusdt,ethusdt` | Binance symbols; first soak uses BTC |
| `LATENCY_ARB_MARKET_ASSET` | `BTC` | Asset selector; BTC only for first soak |
| `LATENCY_ARB_MARKET_DURATION_MINUTES` | `15` | Market duration selector |
| `LATENCY_ARB_STARTING_BALANCE_USD` | `15.48` | Hypothetical account balance |
| `LATENCY_ARB_ORDER_BALANCE_FRACTION` | `0.10` | Fraction of balance per would-order |
| `LATENCY_ARB_MAX_ORDER_SIZE_USD` | `1.55` | Per-order cap |
| `LATENCY_ARB_MAX_POSITION_USD` | `50` | Exposure cap used by shadow executor |
| `LATENCY_ARB_MIN_CONFIDENCE` | `0.6` | Minimum signal confidence |
| `LATENCY_ARB_MAX_DAILY_TRADES` | `20` | Daily would-order cap, reserved for runtime gating |
| `LATENCY_ARB_COOLDOWN_MS` | `60000` | Cooldown, reserved for runtime gating |
| `LATENCY_ARB_MAX_SPREAD_CENTS` | `8` | Reject books wider than this |
| `LATENCY_ARB_MAX_MARKET_AGE_MS` | `2000` | Reject stale books |
| `LATENCY_ARB_SIMULATED_LATENCY_MS` | `750` | Conservative fill latency |
| `LATENCY_ARB_LOG_DIR` | `logs` | JSONL output directory |

## Running a Shadow Soak

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

Disabled smoke check:

```bash
LATENCY_ARB_ENABLED=false npm run start:latency-arb
```

Live-mode safety check:

```bash
LATENCY_ARB_ENABLED=true MODE=small_live npm run start:latency-arb
# Expected: exits with "Latency arb live mode is disabled"
```

## Soak Metrics to Inspect

After 1–2 hours, inspect the JSONL file for:

- eligible markets found vs. no-market skips
- signal count and confidence distribution
- skip reason distribution
- would-place order count
- hypothetical fill count
- mark-to-market PnL
- resolved PnL when outcomes are available
- maker EV vs. taker comparison EV

## Risk Controls

- Real orders are not submitted by latency-arb.
- `MODE=small_live` is hard-blocked.
- Books are rejected when stale, invalid, or too wide.
- Order size is capped from the 15.48 USDC balance assumption.
- Shadow executor validates finite binary prices, exposure, confidence, and minimum size.
- Fill model is conservative: latency delay plus strict cross-through, not mere touch.

## Testing

```bash
npm test -- --runInBand
npm run build
```

Focused latency-arb tests:

```bash
npm test -- tests/data/binance-ws-feed.test.ts \
  tests/engines/divergence-engine.test.ts \
  tests/strategy/latency-arb-market-selector.test.ts \
  tests/strategy/latency-arb-orderbook.test.ts \
  tests/accounting/jsonl-event-writer.test.ts \
  tests/simulation/latency-arb-shadow-executor.test.ts \
  tests/simulation/latency-arb-position-tracker.test.ts \
  tests/integration/latency-arb-runtime.test.ts \
  --runInBand
```

## Future Live Gate

A later live phase requires a separate design and review, including:

- existing small-live preflight integration
- credential and balance checks
- open-order cleanup
- Data API position reconciliation
- Telegram critical alerts
- explicit `LIVE_TRADING_ENABLED=true`
- explicit approval after shadow soak evidence
