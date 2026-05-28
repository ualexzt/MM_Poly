---
title: $30 guarded light-live readiness design
status: approved
approved_at: 2026-05-28
---

# $30 Guarded Light-Live Readiness Design

## Context

The target is to move from paper trading to light-live trading on 2026-06-01 with about $30 of starting capital. The latest paper reports from 2026-05-27 17:00 UTC and 2026-05-28 05:00 UTC still show `CRITICAL` status, including `wide_book_spread`, `negative_executable_exit`, `severe_negative_executable_exit`, and `invalid_book_crossed_or_missing`.

Paper PnL is positive, including positive realized PnL excluding rebates, but this is not enough for live readiness because current paper fills are still optimistic and executable-exit risk persists for some inventory markets.

## Goal

Prepare a guarded `small_live` launch profile for a $30 account while keeping the system in `paper` mode until 2026-05-31 so the updated behavior can soak before the planned 2026-06-01 light-live start.

The first live run is a production smoke test, not a PnL-maximization run.

## Non-goals

- Do not maximize paper PnL.
- Do not loosen risk controls to increase fills.
- Do not start live trading while persistent `CRITICAL` risk remains unresolved.
- Do not rely on maker rebates to justify live readiness.

## Approved Approach

Use a `$30 guarded light-live` profile, combined with exit-safe market filtering and a go/no-go gate before 2026-06-01.

This combines:

1. Strict live exposure and drawdown limits sized for $30.
2. A conservative paper fill model so the pre-live soak is less optimistic.
3. Harder handling of negative executable exit before allowing inventory-increasing quotes.
4. Diagnosis and suppression of persistent crossed/missing-book risk before live.
5. A paper soak window through 2026-05-31 after implementation and deployment.

## Risk Limits for $30 Light-Live

The `small_live` profile should be materially stricter than the paper/default profile.

Target limits:

- Max session or daily live loss: `-$5` absolute, triggering kill switch and cancel-all behavior.
- Max total strategy exposure: about `$20–25`.
- Max per-market exposure: about `$2–3`.
- Base order size: minimum practical live size, target around `$1` if exchange constraints allow it.
- Max order size: about `$1–1.5`.
- Inventory throttle should start earlier than paper:
  - normal below about `10–15%` per-market usage;
  - throttle at about `15–25%`;
  - near-block at about `25–35%`;
  - reduce-only at about `35%`.

These values intentionally reduce expected PnL to preserve the $30 test bankroll.

## Executable-Exit Guard

Negative executable exit must be treated as a trading constraint, not only a reporting signal.

Rules:

- If a market position has `exit at bid/ask < $0`, block the inventory-increasing side for that market.
- If executable exit is around `-$0.10` to `-$0.15` or worse in `small_live`, escalate to CRITICAL/reduce-only for that market or system, depending on the existing risk-manager boundaries.
- If top inventory exit is worse than `-$0.25` during the pre-live paper soak, do not start live.

Inventory-increasing side means:

- BUY when already LONG.
- SELL when already SHORT.

Exit-side quoting should remain available when safe, so inventory can decay.

## Conservative Paper Fill Model

Before using paper reports as live-readiness evidence, paper fills must be less optimistic.

The current paper model fills when an observed trade crosses the paper quote. That omits important live constraints:

- queue position;
- order latency;
- cancel-in-flight risk;
- actual trade size available after earlier queue priority;
- equivalence with live router pre-submit checks.

The updated model should conservatively reduce or delay fills rather than assume every crossing trade is fully fillable. The purpose is not perfect exchange simulation; it is to make paper PnL harder to achieve and therefore more useful as a pre-live gate.

## Crossed/Missing Book Handling

`invalid_book_crossed_or_missing` returned in the 2026-05-28 paper report. Before live, this must be diagnosed.

The implementation should determine whether the cause is:

- a real invalid order book;
- a transient WebSocket update edge case;
- stale market state used in risk reporting;
- an overly sensitive report/risk aggregation rule.

If the cause is transient, use a bounded debounce or consecutive-invalid-ticks requirement before escalating to persistent CRITICAL. Do not hide real invalid books, and do not quote from crossed or missing books.

## Market Quality Gate

The first live run should only trade markets that are exit-safe.

A market is eligible for inventory-increasing live quotes only when:

- bid/ask is valid and not crossed;
- executable exit is not negative for the current position;
- order book depth is sufficient for the configured live order size;
- stale-book guard passes;
- the market is not persistently causing invalid-book risk;
- existing inventory usage is below the strict small-live throttle thresholds.

Wide-book spread alone should not automatically ban a market, because wide spreads can be profitable for market making. However, wide-book plus existing inventory plus negative executable exit must block new inventory.

## Go/No-Go Gate

Before enabling live on 2026-06-01, require the final paper/shadow soak period to show:

- no persistent `CRITICAL` status over the last 12–24 hours;
- no `severe_negative_executable_exit`;
- top inventory markets do not have executable exit worse than `-$0.25`;
- `invalid_book_crossed_or_missing` does not keep the system in persistent CRITICAL;
- realized PnL excluding rebates remains positive;
- inventory usage improves after reduce-only rather than staying stuck;
- Docker build and test commands pass.

If these conditions are not met, remain in paper mode.

## Live Emergency Behavior

Once light-live starts, the bot should stop live trading and cancel open orders when any of these occur:

- session or daily loss reaches `-$5`;
- single-market executable exit reaches around `-$0.15` or worse;
- total exposure exceeds the configured `$20–25` cap;
- per-market exposure exceeds the configured `$2–3` cap;
- WebSocket disconnect, API error, crossed-book, or missing-book state persists beyond a short grace period;
- the risk manager reports persistent CRITICAL rather than a short transient.

## Paper Soak Requirement

After these changes are implemented and deployed, the bot must continue running in `paper` mode until 2026-05-31.

The purpose of this soak is to collect at least one meaningful post-change report window before 2026-06-01 and leave time to fix problems if the new controls produce bad behavior, too few quotes, persistent CRITICAL status, or unexpected inventory accumulation.

## Testing Requirements

Tests should cover:

- strict `small_live` exposure and order-size configuration for a $30 account;
- drawdown kill switch at `-$5`;
- inventory-increasing quote block when executable exit is negative;
- stronger CRITICAL/reduce-only behavior around `-$0.10` to `-$0.15` executable exit in small-live;
- conservative paper fill behavior versus the current optimistic crossing-fill model;
- crossed/missing-book handling so real invalid books are not quoted and transient invalid states do not create misleading persistent CRITICAL reports;
- go/no-go report behavior for persistent CRITICAL and top inventory executable exit worse than `-$0.25`.

All build and test commands must run through Docker, per project policy.
