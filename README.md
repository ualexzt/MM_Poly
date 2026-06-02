# Polymarket Pair-Cost Strategy Foundation

This repository is being reset around one strategy idea: **YES/NO pair-cost trading**.

The target strategy is simple:

```text
Find a binary market where bestAskYES + bestAskNO is below a safe threshold.
If the all-in pair cost is less than $1 after fees/slippage, the paired position has locked payoff.
```

## Current State

This branch intentionally contains only foundation code:

- Gamma market discovery client
- CLOB orderbook read client
- JSONL event writer
- Telegram notifier
- CLOB key generation script
- shared market/book types
- Docker/build/test scaffolding

There is **no active trading runner** in this cleanup state. Production legacy containers were stopped before this reset.

## Commands

```bash
npm install
npm run build
npm test -- --runInBand
npm run generate:clob-key
```

## Next Strategy Build

The next implementation should add a new, test-first pair-cost scanner:

1. read active markets from Gamma;
2. fetch YES and NO orderbooks from CLOB;
3. compute `bestAskYES + bestAskNO`;
4. log opportunities only when the all-in cost is below threshold;
5. stay paper/shadow-only until live evidence justifies execution.

Do not reintroduce removed legacy strategy code.
