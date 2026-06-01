# Latency Arbitrage Live-Like Shadow Design

## Goal

Build a production-shaped latency-arbitrage shadow runtime for BTC 15-minute Polymarket Up/Down markets. The runtime should behave as close as practical to live trading, but must not submit real orders. Instead, it records would-live post-only orders, signal decisions, skips, mark-to-market updates, and final resolutions to JSONL files for a 1–2 hour soak test.

## Current State

The repository already has these latency-arb building blocks:

- `BinanceWsFeed` streams Binance kline price updates.
- `MomentumEngine` tracks short-window momentum.
- `analyzeDivergence` compares momentum-implied probability against a supplied market snapshot.
- `LatencyArbStrategy` wires Binance updates to momentum and exposes `analyzeMarket()`.
- `LatencyArbPaperEngine` can simulate binary trade resolution, but it is not wired into the runner.
- `run-latency-arb.ts` currently starts only the Binance feed and logs stats.

Review found that this is not yet a runnable trading or paper-trading strategy because it does not discover Polymarket markets, read order books, execute or record hypothetical orders, or enforce live-style risk gates in the runtime path.

## Scope for First Soak

### Included

- Market universe: BTC 15-minute Up/Down Polymarket markets only.
- Market discovery: automatic via Gamma API.
- Runtime mode: live-like shadow/paper only.
- Real order submission: hard-disabled.
- `MODE=small_live`: hard-blocked in `run-latency-arb.ts` until a later explicitly approved live phase.
- Starting balance assumption: 15.48 USDC.
- Hypothetical order size: 10% of balance, approximately 1.55 USDC, capped by config.
- Primary order model: post-only maker-like would-order.
- Secondary comparison: taker-like immediate-fill price and EV recorded for analysis only.
- PnL model: mark-to-market during the soak and final resolution when available.
- Logging: JSONL raw event stream under `logs/`.

### Not Included

- Real live order submission.
- ETH markets.
- 5-minute markets.
- Multi-market portfolio optimization.
- Queue-position-perfect fill simulation.
- Full historical backtesting.

## Architecture

Runtime flow:

```text
BinanceWsFeed
  -> MomentumEngine
  -> BTC 15m Market Selector (Gamma)
  -> CLOB Order Book Snapshot Provider
  -> analyzeDivergence
  -> Shadow Risk Gates
  -> Live-Like Shadow Executor
  -> JSONL Event Writer
  -> Position Tracker (MTM + resolution)
```

### Components

#### 1. BTC 15m Market Selector

Responsibility: find active BTC 15-minute Up/Down markets from Gamma API.

Inputs:

- `MarketState[]` from `GammaApiScanner`.
- Config: asset `BTC`, duration `15m`, max markets.

Output:

- One or more eligible `MarketState` entries with YES/NO token IDs.

Selection rules:

- `active === true`
- `closed === false`
- `enableOrderBook === true`
- has both `yesTokenId` and `noTokenId`
- title/slug/question indicates BTC Bitcoin market
- title/slug/question indicates 15-minute Up/Down style market
- nearest currently-live or next-to-expire market first

If no eligible market is found, runtime writes a `skip` event with reason `no_eligible_btc_15m_market`.

#### 2. Order Book Snapshot Provider

Responsibility: turn CLOB order books into latency-arb `MarketSnapshot` data.

Inputs:

- Selected market YES/NO token IDs.
- Existing `ClobApiClient` order book fetch logic.

Output:

- Snapshot containing:
  - `yesPrice`
  - `noPrice`
  - `midpoint`
  - `spread`
  - `timestamp`
  - best bid/ask per side for execution simulation

Validation:

- Reject missing or non-finite prices.
- Reject stale books older than configured max age.
- Reject spread wider than configured max spread.

#### 3. Divergence Engine Fix

The existing `analyzeDivergence` uses a bullish-only EMA bonus. For bearish BUY_NO decisions, `emaFast < emaSlow` should be treated as aligned, not penalized.

Required behavior:

- Bullish + `emaFast > emaSlow`: positive EMA bonus.
- Bearish + `emaFast < emaSlow`: positive EMA bonus.
- Otherwise: negative or zero EMA alignment bonus.

#### 4. Binance Feed Hardening

`BINANCE_WS_URL` is currently parsed but ignored. The feed must accept a configurable base URL and the runner must pass the env value.

Malformed Binance kline payloads should return `null` rather than emitting `NaN` price updates.

#### 5. Live-Like Shadow Executor

Responsibility: convert actionable signals into would-live order events without submitting real orders.

Inputs:

- `DivergenceSignal`
- order book execution snapshot
- risk config
- current hypothetical positions
- balance config

Output event: `would_place_order`

Fields:

- `eventType: "would_place_order"`
- `mode: "shadow" | "paper"`
- `market.conditionId`
- `market.slug`
- `market.question`
- `asset: "BTC"`
- `duration: "15m"`
- `action: "BUY_YES" | "BUY_NO"`
- `orderType: "post_only_limit"`
- `makerPrice`
- `makerEvPct`
- `takerPrice`
- `takerEvPct`
- `sizeUsd`
- `shares`
- `confidence`
- `divergencePct`
- `expectedValuePct`
- `timestamp`
- `reason` / trace fields

Real order submitters must not be invoked by this component.

#### 6. Position Tracker

Responsibility: track hypothetical open positions and PnL.

Events:

- `position_opened` when a maker order is conservatively considered filled.
- `mark_to_market` periodically or whenever a fresh book arrives.
- `position_resolved` when final outcome is known.

Conservative fill rule for first soak:

- Include artificial latency before evaluating fill, default 750ms.
- Maker order is considered filled only if subsequent market data crosses through the maker price, not merely touches it.
- Taker comparison is recorded but does not create the primary position.

MTM:

- YES position marked using current YES bid/mid depending available data.
- NO position marked using current NO bid/mid depending available data.
- If no valid mark exists, write `skip` with reason `no_valid_mtm_price`.

Final resolution:

- If the market closes and outcome is available, close at binary payout: winner pays 1.0, loser pays 0.0.
- If outcome is unavailable during soak, keep position open and rely on MTM.

#### 7. JSONL Writer

Path:

- `logs/latency-arb-orders-YYYY-MM-DD.jsonl`

Required event types:

- `signal`
- `skip`
- `would_place_order`
- `position_opened`
- `mark_to_market`
- `position_resolved`
- `runtime_stats`

Requirements:

- Ensure `logs/` exists.
- Append one valid JSON object per line.
- Do not crash the strategy on a single write failure; log an error and continue unless repeated failures indicate the soak is unusable.

## Risk Gates

Before writing a `would_place_order`, the runtime must pass:

- `LATENCY_ARB_ENABLED === true`
- `MODE !== small_live`
- selected market is active and not closed
- book is not stale
- spread is at or below max configured spread
- signal action is actionable, not `NO_ACTION`
- signal confidence is at or above threshold
- entry price is within configured range
- expected value passes threshold
- daily would-order limit not exceeded
- cooldown has elapsed
- order size is at or below max position/order size
- current hypothetical exposure remains within configured cap
- all prices and sizes are finite positive numbers

## Configuration

New or clarified env/config fields:

- `BINANCE_WS_URL` — used by `BinanceWsFeed`.
- `LATENCY_ARB_MARKET_ASSET=BTC`
- `LATENCY_ARB_MARKET_DURATION_MINUTES=15`
- `LATENCY_ARB_STARTING_BALANCE_USD=15.48`
- `LATENCY_ARB_ORDER_BALANCE_FRACTION=0.10`
- `LATENCY_ARB_MAX_ORDER_SIZE_USD=1.55`
- `LATENCY_ARB_MAX_SPREAD_CENTS` — default conservative, e.g. 8.
- `LATENCY_ARB_MAX_MARKET_AGE_MS` — default 2000.
- `LATENCY_ARB_SIMULATED_LATENCY_MS` — default 750.
- `LATENCY_ARB_LOG_DIR=logs`

Existing fields remain:

- `LATENCY_ARB_ENABLED`
- `LATENCY_ARB_MIN_CONFIDENCE`
- `LATENCY_ARB_MAX_POSITION_USD`
- `LATENCY_ARB_MAX_DAILY_TRADES`
- `LATENCY_ARB_COOLDOWN_MS`
- `BINANCE_SYMBOLS`

## Tests and Validation

Implementation must follow TDD.

Required test areas:

1. BTC 15m market selector filters correctly and orders nearest eligible markets first.
2. Binance feed uses configured base URL.
3. Binance feed rejects malformed kline payloads instead of emitting `NaN`.
4. Divergence EMA bonus is direction-aware for BUY_NO.
5. Order book snapshot provider rejects stale, wide, or invalid books.
6. Shadow executor writes `would_place_order` JSONL and never calls a live submitter.
7. Position tracker marks to market and resolves positions correctly.
8. Runner hard-blocks `MODE=small_live` for latency-arb.
9. Integration test drives price update + market snapshot + would-order JSONL through runtime path.
10. Full `npm run build` and `npm test` pass.

## Soak Procedure

1. Deploy with real orders disabled.
2. Set:

```bash
LATENCY_ARB_ENABLED=true
MODE=shadow
LIVE_TRADING_ENABLED=false
LATENCY_ARB_MARKET_ASSET=BTC
LATENCY_ARB_MARKET_DURATION_MINUTES=15
LATENCY_ARB_STARTING_BALANCE_USD=15.48
LATENCY_ARB_ORDER_BALANCE_FRACTION=0.10
LATENCY_ARB_MAX_ORDER_SIZE_USD=1.55
```

3. Run `npm run start:latency-arb` for 1–2 hours.
4. Inspect JSONL metrics:
   - number of eligible markets found
   - number of signals
   - skip reason distribution
   - would-place order count
   - conservative hypothetical fill count
   - MTM PnL
   - resolved PnL if available
   - taker comparison EV

## Production Live Gate

This design intentionally does not enable live order submission. A later live phase requires a separate design and review, including:

- integration with existing small-live preflight checks
- startup open-order cleanup
- credential validation
- balance and position reconciliation
- Telegram critical alerts
- explicit `LIVE_TRADING_ENABLED=true`
- explicit user approval after paper soak evidence

Until then, latency-arb must refuse to run in `MODE=small_live`.
