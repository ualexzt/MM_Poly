# micro_gabagool_maker_v1 Live Data MVP Design

## Goal

Connect `micro_gabagool_maker_v1` to live Polymarket market/orderbook data in safe paper/shadow mode so it can discover real opportunities, score them, and emit would-trade JSONL/Telegram signals without placing live orders.

## Scope

### In scope

- Add a Gamma-backed market scanner that returns normalized `MarketCandidate` objects.
- Add a CLOB orderbook adapter for best bid/ask and top-of-book USD sizes.
- Compute WMP and simple rolling market microstructure signals needed by the scorer:
  - `wmpDelta3Min`
  - `spreadChangesLast60Sec`
- Add a runnable `npm run start:gabagool` entrypoint using the existing `runGabagoolCycle` function.
- Add paper/shadow JSONL logging for scan, reject, score, and entry events.
- Add Telegram startup and would-entry notifications when configured.
- Keep live trading fail-closed.

### Out of scope

- Real CLOB order submission for this strategy.
- WebSocket fill detection.
- Production deployment.
- Taker force-exit in live mode.
- Complex market ranking beyond the existing score function.

## Architecture

```text
Gamma API active markets
  -> GammaMicroGabagoolScanner
  -> CLOB orderbook fetch per token
  -> RollingMarketStats
  -> MarketCandidate[]
  -> runGabagoolCycle
  -> Paper/Shadow OrderManager events
  -> JSONL + optional Telegram
```

The live-data scanner is intentionally an adapter around existing pure engines. It does not own scoring, filtering, risk decisions, or order lifecycle. It only normalizes external data into `MarketCandidate`.

## Components

### `GammaMicroGabagoolScanner`

Responsibility: fetch candidate markets from Gamma and enrich them with CLOB best bid/ask data.

Inputs:
- Gamma API base URL
- CLOB API base URL
- max markets per scan
- now function
- rolling stats store

Output:
- `MarketCandidate[]`

Rules:
- Only include active, open, non-closed markets.
- Skip markets without a valid condition id.
- Skip markets without a YES token id.
- Skip markets without a close/end date.
- Use YES-side orderbook for v1.
- If orderbook fetch fails for one market, skip that market and continue scanning.

### `ClobMicroOrderbookClient`

Responsibility: fetch and normalize a single token orderbook.

Output:
- best bid price
- best ask price
- best bid size in USD estimate
- best ask size in USD estimate

Conservative sizing:
- bid USD size = bid price × bid share size
- ask USD size = ask price × ask share size

### `RollingMarketStats`

Responsibility: maintain minimal in-memory history per market to compute WMP deltas and spread change count.

Rules:
- WMP = `(P_bid * V_ask + P_ask * V_bid) / (V_bid + V_ask)`
- `wmpDelta3Min` = absolute difference between current WMP and the oldest sample at or before 3 minutes ago, or 0 if insufficient history.
- `spreadChangesLast60Sec` = count of spread changes in the last 60 seconds.
- Drop samples older than 5 minutes.

### Runner wiring

`src/run-micro-gabagool.ts` should stay testable. The CLI bootstrap can live in the same file or a small companion module, but must not run when imported by tests.

The runner should:
- load config from environment with safe defaults
- assert live mode is disabled unless explicitly allowed
- instantiate scanner, risk manager, order manager, paper engine, and PnL tracker
- run cycles on an interval
- write JSONL logs under `logs/micro-gabagool-YYYY-MM-DD.jsonl`
- optionally send Telegram startup and would-entry messages

## Error Handling

- Gamma scan failure: emit `scan_error`, keep process alive, retry next interval.
- Per-market orderbook failure: skip market; no process crash.
- Invalid API payload: skip invalid market/orderbook; no process crash.
- JSONL write failure: log to stderr, keep process alive.
- Telegram failure: log to stderr, keep trading loop alive.

## Safety

- Default mode is `paper`.
- `live` mode requires `ENABLE_LIVE_TRADING=true` but still does not place real orders in this MVP.
- Existing `assertGabagoolModeAllowed` remains fail-closed.
- No private keys are needed for this MVP.

## Testing Strategy

- Unit tests for Gamma payload normalization.
- Unit tests for CLOB orderbook normalization.
- Unit tests for rolling WMP/spread stats.
- Integration test for scanner skipping bad markets and returning a valid `MarketCandidate`.
- Runner test ensuring `start:gabagool` script is wired and live mode remains blocked unless explicitly enabled.

## Acceptance Criteria

- `npm run build` passes.
- Full `npm test -- --runInBand` passes.
- `npm run start:gabagool` exists in `package.json`.
- Scanner can be tested without network via injected fetch.
- No real order placement is introduced.
- JSONL/would-entry logging remains deterministic in tests.
