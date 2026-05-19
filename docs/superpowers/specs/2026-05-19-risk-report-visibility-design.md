# Risk Report Visibility Design

## Goal

Improve PAPER-mode risk visibility before any LIVE consideration. The change should make inventory risk, rebate dependency, and risk status persistence visible in the Telegram report without changing trading behavior, quote generation, inventory limits, or execution logic.

## Scope

In scope:
- Add PnL excluding estimated rebates to Telegram risk reports.
- Add a top inventory markets section to show the highest-risk open positions.
- Replace the static action text with status-aware guidance.
- Add diagnostics for time spent in non-OK risk status.
- Add an inventory trend indicator comparing current inventory usage with the previous report interval.
- Add tests for formatting, risk-state tracking, and safe fallback behavior.

Out of scope:
- Changing inventory thresholds.
- Changing reduce-only behavior.
- Changing quote placement, sizing, or fill simulation.
- Adding LIVE trading behavior.

## Report Changes

### PnL ex-rebates

The Telegram report should include an `Estimated Total ex Rebates` line. It should be calculated as realized cumulative PnL plus fair-based unrealized PnL, excluding estimated maker rebates.

This makes it clear whether the strategy is profitable before incentives. Existing rebate and estimated-total lines remain unchanged.

### Top Inventory Markets

The report should include a `Top Inventory Markets` section with up to five open positions. Each row should include:
- Market title.
- Position side and size.
- Inventory usage percentage when available.
- Fair price.
- Best bid/ask.
- Exit PnL at bid/ask when available.
- Risk reasons for that market when present.

Sorting should prioritize highest inventory usage. If usage is unavailable, sorting should fall back to absolute net position. Empty lists should render a clear fallback such as `none` rather than failing.

### Dynamic Action

The `Action` section should be derived from risk status and reasons:

- `OK`: continue PAPER soak and monitor normal risk metrics.
- `WATCH` with `inventory_soft_limit_exceeded`: stay PAPER and monitor whether inventory decays back below soft limit.
- Other `WATCH`: stay PAPER and inspect listed reasons before considering LIVE.
- `WARNING`: inspect top inventory markets and reduce exposure before considering LIVE.
- `CRITICAL`: review cancel/kill-switch path before continuing.

The action text should remain operational guidance only. It must not trigger any behavior.

## Risk Visibility Changes

### Time in non-OK status

Risk reporting should track how long the strategy has continuously been in a non-OK status (`WATCH`, `WARNING`, or `CRITICAL`). The timer starts when status first leaves `OK`, keeps increasing while status remains non-OK, and resets when status returns to `OK`.

The Telegram report should render this value when available. If there is not enough history, it should render `n/a`.

### Inventory trend

The report should compare current top inventory usage with the previous report interval. It should render:

- `improving` when usage decreases.
- `worsening` when usage increases.
- `flat` when unchanged.
- `n/a` when no previous value exists.

The displayed format should show previous and current values when both are available, for example: `17.10% → 14.80% improving`.

## Data Flow

The risk/reporting layer should collect current per-market risk decisions, derive top inventory markets, compare aggregate top inventory usage with the previous report snapshot, and pass the resulting diagnostics into the Telegram formatter.

The formatter should remain mostly presentational: it should format fields and choose action text, but it should not own trading decisions.

## Error Handling and Fallbacks

- Missing bid/ask exit PnL renders as `not available`.
- Missing fair, bid, ask, or inventory usage renders as `n/a`.
- Empty top inventory list renders as `none`.
- Missing previous trend snapshot renders as `n/a`.
- Unknown or empty risk reasons should not break report generation.

## Tests

### Telegram formatter tests

- Renders `Estimated Total ex Rebates` correctly.
- Renders `Top Inventory Markets` with up to five entries.
- Renders safe fallbacks for empty inventory list and missing exit PnL.
- Produces different `Action` text for `OK`, inventory `WATCH`, `WARNING`, and `CRITICAL`.

### Risk state tests

- `timeInNonOkStatus` increases while status remains non-OK.
- `timeInNonOkStatus` resets after returning to `OK`.
- `inventoryTrend` renders `n/a` without previous data.
- `inventoryTrend` identifies improving, worsening, and flat cases.

### Regression tests

- Existing report fields continue to render.
- Trading behavior remains unchanged by these reporting additions.

## Acceptance Criteria

- PAPER Telegram report clearly shows PnL excluding rebates.
- Report shows top risk-bearing open positions, not only the main quoted market.
- Action guidance is status-aware instead of generic.
- Report shows whether WATCH conditions are improving or worsening over time.
- All additions are safe when optional data is missing.
- No quote generation, risk limit, reduce-only, or execution behavior changes.
