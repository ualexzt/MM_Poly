# Small Live Safety, Accounting, Profitability Filters, and Telegram Monitoring Design

Date: 2026-05-31
Project: MM_Poly Polymarket market making bot
Status: Approved design

## Context

The bot was tested in `small_live` mode and exposed several production issues:

- It could consume most available USDC by placing too many live orders relative to a small deposit.
- Live `matched` order responses were not reliably reflected in internal inventory unless the user WebSocket delivered fill events.
- Stale or previously leaked open orders could keep balance locked.
- Markets with pathological books such as `bestBid=0.001` / `bestAsk=0.999` were still considered eligible.
- The user cannot monitor the system continuously, so Telegram alerts and periodic summaries are required.

Production is currently safe:

- Bot stopped.
- Server `.env` set to `MODE=shadow`, `LIVE_TRADING_ENABLED=false`, `MAX_MARKETS=1`.
- Read-only diagnostics showed: open orders = 0, positions = 0, CLOB collateral balance = 15.481611 USDC.

## External References

Implementation must follow official Polymarket documentation and SDK behavior:

- Polymarket CLOB order creation / `createAndPostOrder` docs.
- Polymarket CLOB `getOpenOrders`, cancellation, and balance/allowance docs.
- Polymarket authenticated User WebSocket channel docs.
- Polymarket market maker / liquidity rewards docs.
- Polymarket min order size and reward min size constraints.

Key design implication: rewards are secondary. The bot must not increase order size only to satisfy reward minimums when that conflicts with account safety or expected edge.

## Risk Envelope

Approved next live envelope: **Small live C**.

- Max active exposure: 10 USDC.
- Max markets: 2.
- Live trading only after shadow verification.
- Telegram alerts required before live enablement.
- Default production deployment remains safe/shadow.

## Goals

1. Prevent uncontrolled balance depletion.
2. Track positions and open orders accurately enough for live risk control.
3. Avoid trading markets without a measurable maker edge.
4. Alert the user quickly when the bot, server, or exchange interaction is unhealthy.
5. Send a short Telegram trading/risk report every 3 hours.
6. Provide a safe deployment path: shadow first, live only after verification.

## Non-Goals

- No prediction model for event outcomes.
- No guarantee of profitability.
- No broad refactor outside the live safety/accounting/monitoring path.
- No scaling beyond 2 markets until the small-live envelope proves stable.

## Safety Gate Before Live

Before `small_live` can place any real order, startup and runtime checks must pass:

- `MODE=small_live` and `LIVE_TRADING_ENABLED=true` must both be explicit.
- `MAX_MARKETS <= 2` for this phase.
- `MAX_EXPOSURE_USD <= 10` for this phase.
- Telegram credentials must be configured and a startup alert must succeed.
- CLOB open orders must be zero or cancel-all must complete successfully.
- Data API positions must load successfully.
- CLOB collateral balance must be sufficient for the configured market count and min order size.
- Projected active order notional must not exceed the risk envelope.
- If any check fails, the bot must refuse live trading and send a Telegram blocker alert.

## Accounting and Inventory Source of Truth

The bot should combine multiple sources rather than relying on one fragile path:

1. **Startup Data API positions**
   - Seed inventory from current portfolio positions.

2. **CLOB open orders**
   - Reconcile open order count/notional at startup and periodically.
   - Detect order leaks where internal slots show no order but CLOB has open orders.

3. **Order submit response**
   - `status=live`: track as open order.
   - `status=matched`: immediately update inventory using `takingAmount` and `makingAmount`.
   - balance/allowance rejects: count as submit rejects and apply risk throttling.

4. **User WebSocket events**
   - Use as a real-time confirmation path for order/fill updates.
   - Do not rely on it as the only inventory update mechanism.

5. **Periodic reconciliation**
   - Compare internal inventory against Data API positions.
   - If mismatch exceeds tolerance, switch to shadow/stop-new-orders and alert.

## Market Selection and Profitability Filters

The bot should not trade every eligible-looking market. It should reject markets with weak or misleading books.

Required filters:

- Reject pathological books such as `bestBid <= 0.001` and `bestAsk >= 0.999` when midpoint is artificially near 0.5.
- Require meaningful top-of-book and depth near the intended quote.
- Require effective spread and expected edge above a configurable minimum.
- Reject markets where min order size would consume too much of the active exposure budget.
- Treat rewards as optional upside, not a reason to override risk sizing.
- Continue to respect stale-book, catalyst, resolution-window, toxicity, and inventory throttles.

Profitability target:

- The bot should only quote when expected spread capture after fees/slippage risk is positive under conservative assumptions.
- If this cannot be measured for a market, skip the market.

## Runtime Risk Controls

Runtime controls should prevent repeat balance depletion:

- Stop new BUY orders when free collateral is below the minimum required order amount plus safety buffer.
- Allow SELL/reduce-only orders only when inventory exists and CLOB balance/allowance permits.
- Refuse to submit if projected active order notional exceeds 10 USDC.
- Refuse to submit if CLOB open orders exceed expected internal order slots.
- Cancel all and switch to shadow on repeated submit rejects or inventory mismatch.
- Keep `MAX_MARKETS=1` during initial validation; move to 2 only after stable shadow/live verification.

## Telegram Monitoring

### Immediate Alerts

Send short alerts for:

- Bot started/stopped and current mode.
- Live trading enabled.
- Startup blocker.
- Submit reject threshold exceeded.
- Balance too low for next order.
- CLOB open order leak.
- Inventory mismatch.
- User/market WebSocket disconnect beyond threshold.
- CLOB/Data API repeated errors.
- Emergency stop / switch to shadow.

Alerts must be rate-limited to avoid spam but must not suppress critical state transitions.

### 3-Hour Report

Every 3 hours send a compact report:

```text
Mode: shadow/small_live
Balance: $...
Open orders: N / $...
Positions: N / $...
PnL realized/unrealized: $...
Fills 3h: N
Rejects 3h: N
Active markets: N
Risk state: OK/WARN/STOP
```

Reports should be available in both shadow and live modes.

## Deployment Flow

1. Implement locally with tests.
2. Deploy production in safe mode:
   - `MODE=shadow`
   - `LIVE_TRADING_ENABLED=false`
   - `MAX_MARKETS=1`
3. Run shadow for 30-60 minutes.
4. Review Telegram reports and logs.
5. If clean, switch to controlled live:
   - `MODE=small_live`
   - `LIVE_TRADING_ENABLED=true`
   - `MAX_EXPOSURE_USD=10`
   - `MAX_MARKETS=1` initially, then 2 after validation.
6. Monitor first 5-10 minutes live before leaving unattended.

## Testing Requirements

Add or update tests for:

- `matched` submit response updates inventory immediately.
- BUY fill causes subsequent inventory percentage to be non-zero.
- SELL quote is allowed only when inventory exists.
- Balance too low blocks new BUY submissions before hitting CLOB reject.
- Open order leak detection refuses live start or switches to shadow.
- Pathological books are filtered out.
- Shadow mode never calls live submitter.
- Telegram 3-hour report formatting.
- Telegram alert rate limiting for repeated rejects/errors.

## Success Criteria

Before any live restart:

- All affected tests pass.
- Production is deployed in shadow mode.
- Telegram startup and report messages verified.
- Shadow logs show no live submits.
- Open orders remain zero during shadow.
- Positions reconcile correctly.
- A written live go/no-go checklist is reviewed.

Live is considered stable only if, during the first controlled run:

- No unbounded order accumulation.
- No repeated balance/allowance rejects.
- Inventory and positions remain reconciled.
- Telegram reports arrive as expected.
- Active exposure stays within 10 USDC.
