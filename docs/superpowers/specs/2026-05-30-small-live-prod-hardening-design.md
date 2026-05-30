# Small Live Production Hardening Design

## Goal
Make `small_live` fail closed before production launch: no live loop starts with missing secrets, unknown inventory, orphan open orders, failed startup cancellation, failed go/no-go checks, or stale fair-price inputs.

## Scope
In scope:
- Startup preflight for required live env values, including strict private-key format and `WALLET_ADDRESS`.
- Telegram alert for startup blockers when Telegram credentials are available.
- Mandatory Data API position reconciliation before live quoting.
- Startup open-order cancellation before the first strategy cycle.
- Shutdown cancellation failure surfaced as a failed shutdown instead of false success.
- YES and NO book staleness checks before quote generation.
- Live cancel-replace state handling so a successfully cancelled order does not remain in a local slot when replacement submit fails.
- Wiring the existing go/no-go evaluator into live startup through a small preflight abstraction.

Out of scope:
- Full CLOB dependency replacement.
- Persistent live inventory database.
- New UI or dashboard.
- Complex Telegram retry queues.

## Design
Add small, testable helpers rather than embedding more logic directly in `run-small-live.ts`:

1. `src/strategy/small-live-preflight.ts` validates live env and builds/sends startup-blocker Telegram alerts. It returns structured blockers so tests can verify behavior without exiting the process.
2. `src/strategy/small-live-runner.ts` keeps order-cancellation helpers, but `cancelAllLiveOrders()` returns a result with `total`, `failed`, and `failedOrderIds` instead of only logging.
3. `run-small-live.ts` uses the preflight helpers before connecting the user stream or running the first cycle: validate env, load positions, cancel open orders, evaluate go/no-go inputs, then start the loop.
4. `StrategyRunner` checks both YES and NO books for staleness and clears local slots after confirmed live cancellation even if replacement submit fails.

## Error Handling
Startup blockers are fail-closed. If Telegram credentials are configured, send a concise alert before exit. If Telegram is missing or alert sending fails, log locally and still fail closed. Shutdown attempts to cancel all open live orders; if known cancels fail, it logs the failure and exits non-zero.

## Testing
Use TDD. Add focused regression tests for:
- missing/invalid live env blockers and Telegram alert behavior;
- reconciliation failure blocking startup through extracted preflight functions;
- startup cancel-all failure result;
- shutdown cancellation failure result;
- stale NO book cancels/skips live quoting;
- cancel-replace stale slot clearing after cancel success + submit failure;
- go/no-go blocker wiring.

## Deployment Notes
Before production: rotate local `.env` secrets found during review, keep `.env` only on the server with restrictive permissions, rerun test/build/audit, and repeat review.