# Small Live Pilot Design

## Goal
Run the 15-minute Gabagool accumulator/equalizer strategy with a hard maximum real exposure of **$2**, fail-closed by default, and no paper-style fake fills.

## Scope
In scope:
- Add a safe `small_live` mode for the existing accumulator runner.
- Keep current `paper` mode as the default.
- Place real post-only BUY limit orders only when both explicit live gates are enabled.
- Track live exposure only from observed fills, not from order placement.
- Cancel open orders before expiry / settlement buffer.

Out of scope:
- Increasing exposure beyond $2.
- Selling/liquidating positions before resolution.
- Multi-market live trading.
- Automated balance transfer, funding, or wallet setup.

## Safety Gates
Live trading must require all of:
- `TRADING_MODE=small_live`
- `ENABLE_LIVE_TRADING=true`
- valid wallet/API credentials in environment

If any gate is missing, the system must run paper mode or fail closed with no live orders.

## Live Risk Limits
Initial live pilot limits:
- `maxExposureUsd = 2`
- `maxExposurePerMarketUsd = 2`
- `tradeSize = 1` share
- `maxOpenOrders = 1`
- BTC/ETH 15-minute markets only
- one selected market at a time
- no trading inside the 120-second settlement buffer

## Execution Model
Paper mode can keep its current simulated immediate-fill behavior.

Small live mode must not update `PositionTracker` when an order is created. Instead:
1. Place a post-only BUY limit order through the Polymarket CLOB client.
2. Poll open orders / order status / trade history.
3. Update `PositionTracker` only for confirmed filled quantity.
4. Log order placement and fill events separately.

## Order Lifecycle
For each 15-minute market:
- Before evaluating a new cycle, cancel stale open orders.
- If current market is expired or inside settlement buffer, cancel all open orders for that market.
- Do not carry open orders into the next 15-minute market.
- Expired tracked positions are closed in local statistics via existing `market_expired` handling.

## Components
- `src/config/live-mode.ts`: parse and validate mode/gates/limits.
- `src/execution/polymarket-live-order-client.ts`: adapter from `OrderManager` interface to CLOB client.
- `src/execution/live-fill-tracker.ts`: fetch confirmed fills and update `PositionTracker`.
- `src/run-accumulator.ts`: choose paper vs small_live dependencies and limits.

## Logging
JSONL events must distinguish:
- `live_order_placed`
- `live_order_rejected`
- `live_fill_observed`
- `live_order_cancelled`
- existing `accumulator_entry`, `equalizer_rebalance`, `risk_blocked`, `market_expired`

Telegram is not required for the first pilot.

## Testing
Required tests:
- Missing live gates cannot create a live order client.
- Small live config uses `$2` max exposure and `1` share trade size.
- Live runner does not update position on order placement.
- Position updates only when fill tracker reports a confirmed fill.
- Settlement buffer cancels live open orders.
- Existing paper tests remain passing.

## Deployment
Deploy remains via GitHub pull on production and Docker rebuild. First live run must use environment variables on production; no credentials are committed to git.

## Acceptance Criteria
- Build passes.
- Full test suite passes.
- Production default remains paper mode unless live gates are explicitly set.
- With gates disabled, code path cannot place live orders.
- With gates enabled and mocked CLOB client, exactly one post-only order can be placed under `$2` exposure cap.
