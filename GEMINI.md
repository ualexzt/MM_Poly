# Polymarket Rebate-Aware Market Making Strategy

## Project Overview
This is a TypeScript-based project implementing a Rebate-Aware Market Making Strategy for Polymarket CLOB V2 (Phase 1: Paper Core). The primary goal is to build a conservative, risk-first maker strategy that captures spread and maker-side incentives without accumulating uncontrolled toxic inventory. It intentionally avoids predicting event outcomes as its primary edge.

The system is designed with multiple operational modes in mind: `paper` (simulated), `shadow` (computes live targets but does not execute), and `small_live` (real orders with strict limits). The current phase focuses on a robust paper-mode execution engine.

Key architectural features:
- **Pure Engines:** Logic for fair price, toxicity, inventory skew, and quote calculation are decoupled into pure functions without external dependencies.
- **Strict Risk Controls:** Synchronous kill switches, exposure limits, and stale-book guards are mandatory prior to any order generation.
- **Accounting:** Precise PnL attribution broken down by spread capture, estimated rebates, adverse selection, and inventory mark-to-market.
- **Decision Tracing:** Every quote decision (whether quoted, skipped, or cancelled) produces a structured diagnostic trace.

## Building and Running

The project relies on Node.js (>=20.0.0) and uses `tsx` for running scripts and `jest` for testing.

```bash
# Install dependencies (if not already done)
npm install

# Build the project (TypeScript compilation)
npm run build

# Run the test suite
npm run test
npm run test:watch
npm run test:coverage

# Run the strategy in different modes
npm run start:paper   # Simulated orders and fills only
npm run start:shadow  # Live data, real targets, no order placement
npm run start:live    # Real post-only orders (requires explicit config flag)
```

**Environment Setup:** Copy `.env.example` to `.env` and fill in necessary values like the Telegram bot token and chat ID before running.

## Development Conventions

- **Module Layout:** The codebase enforces strict boundaries:
  - `src/engines/`: Pure logic functions (Fair Price, Toxicity, Inventory, Quote). Must have no side effects.
  - `src/strategy/`: Orchestration, config, and market selection.
  - `src/risk/`: Guards and kill switches.
  - `src/accounting/`: PnL tracking and structured decision tracing.
  - `src/simulation/`: The paper execution models.
  - `src/data/`: API and WebSocket connectors.
- **Testing:** Test-Driven Development is heavily emphasized.
  - Every engine has an associated unit test (e.g., `tests/engines/fair-price-engine.test.ts`).
  - Integration tests validate the complete end-to-end paper pipeline.
  - Runtime invariants (e.g., "no live orders in paper mode") have dedicated assertion tests (`tests/invariants/runtime.test.ts`).
- **Safety & Robustness:** Never bypass risk checks to generate quotes faster. Live trading is gated and disabled by default. The execution simulation must remain conservative (e.g., fills only happen when observed trades cross the placed quote).
- **Configuration:** Magic numbers are prohibited. All operational thresholds and risk boundaries must live in typed configuration files (like `src/strategy/config.ts`).

## Version Control & Deployment

- **Mandatory Commits:** You must commit and push all changes to the repository immediately after making any modifications, fixing bugs, or adding new features.
- **Production Deployment:** To deploy changes to the production environment, connect via SSH and navigate to the project directory:
  ```bash
  ssh oraculus@46.225.147.43
  cd /opt/polymarketmm
  ```