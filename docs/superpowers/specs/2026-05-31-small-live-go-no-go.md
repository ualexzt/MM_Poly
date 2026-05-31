# Small Live Go/No-Go Checklist

> **Scope:** Risk envelope C — max active exposure $10, max markets 2, Telegram required.
> **Current state:** Shadow deployment verified. Live remains disabled until explicit go.

---

## Required Before Live

- [x] Production `.env` has `MODE=shadow` during review.
- [x] `LIVE_TRADING_ENABLED=false` during review.
- [x] Open orders = 0 (verified by CLOB API diagnostic).
- [x] Positions reconcile with Data API (verified: 0 positions).
- [x] CLOB collateral balance recorded (verified: $15.48).
- [x] Telegram startup alert received (verified: manual send succeeded to channel).
- [x] Shadow ran with no `SUBMIT_START` / `SUBMIT_RESULT`.
- [x] No repeated CLOB/Data API errors in shadow logs.
- [x] All 206 tests passing (34 suites).
- [x] Build passes (`npm run build`).
- [ ] **User explicitly approves live switch** — this is the final blocker.

---

## Live Settings For First Run

```env
MODE=small_live
LIVE_TRADING_ENABLED=true
MAX_MARKETS=1
MAX_EXPOSURE_USD=10
TELEGRAM_REPORT_INTERVAL_HOURS=3
```

---

## First 10 Minutes Live

- [ ] Observe logs continuously.
- [ ] Confirm open order count stays within expected slots.
- [ ] Confirm no repeated balance/allowance rejects.
- [ ] Confirm inventory changes after any matched response.
- [ ] Confirm Telegram alert/report path remains healthy.

---

## Stop Conditions

Stop immediately and return to `MODE=shadow` if any of the following occurs:

1. Any open order leak (open orders not tracked by internal state).
2. Any inventory mismatch between Data API / CLOB / internal tracker.
3. Three balance/allowance rejects in a report window.
4. WebSocket disconnect beyond kill-switch tolerance.
5. User requests stop.
6. `activeExposureUsd > MAX_EXPOSURE_USD` alert fires.
7. `open_order_leak` or `submit_rejects_above_threshold` blocker fires.
