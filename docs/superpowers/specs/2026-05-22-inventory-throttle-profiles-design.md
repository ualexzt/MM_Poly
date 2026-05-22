---
title: Inventory Throttle Profiles Design
date: 2026-05-22
status: approved-for-planning
---

# Inventory Throttle Profiles Design

## Goal

Reduce single-market inventory buildup while preserving profitable market-making behavior. The priority is stability and small_live readiness over maximizing paper-mode PnL.

The immediate risk pattern is that a market can remain active while inventory usage worsens from WATCH into WARNING. The desired behavior is gradual suppression of inventory-increasing quotes before reduce-only mode, while keeping exit-side quotes active so exposure can decay.

## Scope

In scope:

- Add adaptive inventory throttle profiles for `paper` and `small_live` modes.
- Apply throttling only to the inventory-increasing side of a market.
- Preserve exit-side quoting so profitable inventory reduction remains available.
- Keep all thresholds in typed configuration.
- Add tests for profile selection, LONG/SHORT side behavior, and reduce-only transition.

Out of scope:

- Fair price changes.
- Toxicity model changes.
- Market universe changes.
- Full portfolio optimizer or cross-market capital allocator.
- Live order behavior beyond existing `small_live` risk posture.

## Profiles

### Paper profile

Paper mode remains useful for discovering profitable opportunities, so throttling should be softer:

| Inventory usage | Behavior on inventory-increasing side |
| --- | --- |
| `<25%` | Normal quoting |
| `25–35%` | Size down, mild extra widening |
| `35–45%` | Stronger size down and widening |
| `45–50%` | Near-block inventory-increasing quotes |
| `>=50%` | Reduce-only |

### small_live profile

small_live should be stricter because realized execution and liquidity can deteriorate faster than paper assumptions:

| Inventory usage | Behavior on inventory-increasing side |
| --- | --- |
| `<20%` | Normal quoting |
| `20–30%` | Size down and extra widening |
| `30–40%` | Strong throttle |
| `40–45%` | Near-block inventory-increasing quotes |
| `>=45%` | Reduce-only |

## Side semantics

Throttle applies to the side that would increase the current position:

- If position is LONG, `BUY` is inventory-increasing and `SELL` is exit-side.
- If position is SHORT, `SELL` is inventory-increasing and `BUY` is exit-side.
- If position is FLAT, no inventory-side throttle applies.

Exit-side quotes should not be penalized by the throttle ladder. Existing risk checks, stale-book guards, toxicity guards, exposure limits, and post-only checks still apply.

## Throttle effects

Each throttle tier should express two effects:

1. Size multiplier for inventory-increasing quotes.
2. Extra half-spread widening for inventory-increasing quotes.

The near-block tier should make new inventory accumulation practically unavailable. It may do this by applying a very small size multiplier that falls below minimum order size or by explicitly rejecting the inventory-increasing quote. The implementation should choose the simpler approach that fits existing quote-generation flow.

Reduce-only remains the hard boundary where only exit-side quotes are allowed.

## Configuration

All new thresholds and multipliers must live in typed strategy configuration, not inline constants.

Recommended initial values:

### paper

| Tier start | Size multiplier | Extra widening |
| --- | ---: | ---: |
| `25%` | `0.50` | `0.5c` |
| `35%` | `0.25` | `1.5c` |
| `45%` | `0.05` | `3.0c` |
| `50%` | reduce-only | n/a |

### small_live

| Tier start | Size multiplier | Extra widening |
| --- | ---: | ---: |
| `20%` | `0.50` | `0.75c` |
| `30%` | `0.20` | `2.0c` |
| `40%` | `0.05` | `4.0c` |
| `45%` | reduce-only | n/a |

These values are intentionally conservative for small_live. They can be tuned after paper evidence shows reduced time in non-OK states without excessive PnL loss.

## Expected behavior

A market with rising inventory usage should progressively lose ability to accumulate more inventory. It may still quote the exit side, allowing the position to shrink when the market trades through those quotes.

For the observed China/Taiwan-style case, the expected behavior is:

- The market can remain profitable.
- The strategy stops increasing the LONG position before reaching 50% inventory usage in small_live.
- WARNING means the system is already strongly biased toward reducing exposure.
- The market should not remain a dominant accumulation target while in WARNING.

## Testing strategy

Add unit tests around the pure throttle behavior and integration-level tests around quote generation or risk decisions.

Required test cases:

1. Paper profile applies the correct tier at 25%, 35%, 45%, and 50%.
2. small_live profile applies stricter thresholds at 20%, 30%, 40%, and 45%.
3. LONG position throttles `BUY` but not `SELL`.
4. SHORT position throttles `SELL` but not `BUY`.
5. FLAT position does not throttle either side.
6. Reduce-only rejects inventory-increasing side and allows exit-side where other guards pass.
7. Near-block tier prevents practical accumulation.

All build and test commands must run through Docker per project policy.

## Success criteria

The change is successful when:

- Configuration exposes separate `paper` and `small_live` inventory throttle profiles.
- Quote generation or risk gating applies the selected profile by mode.
- Inventory-increasing quotes become smaller and wider as usage rises.
- Exit-side quotes remain available unless blocked by existing independent guards.
- Tests cover the profile and side behavior.
- Docker-based build/test verification passes.
