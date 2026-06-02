# Polymarket Pair-Cost Strategy Foundation

## Project Overview

This codebase is being reset around a single strategy family: **YES/NO pair-cost trading** on Polymarket binary markets.

The core business rule is:

```text
bestAskYES + bestAskNO + estimated costs < 1.00
```

A paired YES/NO position pays $1 at resolution regardless of outcome, so profit exists only when both sides can be acquired below $1 all-in. The project should not rely on directional prediction as its primary edge.

## Current Scope

The repository currently keeps only reusable infrastructure:

- Gamma market discovery reads
- CLOB orderbook reads
- JSONL logging
- Telegram notification utility
- CLOB key generation script
- shared market/book types
- Docker/build/test scaffolding

There is no active trading daemon after cleanup. Production legacy containers were stopped before this reset.

## Development Rules

- Use TDD for every new behavior.
- Keep engines pure and side-effect free.
- Default all future runners to paper/shadow; live trading must fail closed.
- Do not place real orders until a separate reviewed live-execution plan exists.
- Avoid speculative abstractions; add only the code needed for the next verified step.
- Magic numbers belong in typed configuration.
- JSONL/Telegram failures must not crash a runner.

## Commands

```bash
npm install
npm run build
npm test -- --runInBand
npm run generate:clob-key
```

## Legacy Code Policy

Do not reintroduce removed legacy strategy code unless the user explicitly asks for an archival reference. The next implementation should focus on a clean pair-cost scanner first.

## Version Control

Commit and push all code changes after verification.
