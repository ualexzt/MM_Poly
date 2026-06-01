# Polymarket Market Making Bot

A TypeScript-based Rebate-Aware Market Making Strategy for Polymarket CLOB V2 (Phase 1: Paper Core).

## Overview

This bot implements a conservative, risk-first maker strategy that captures spread and maker-side incentives without accumulating uncontrolled toxic inventory. It intentionally avoids predicting event outcomes as its primary edge.

**Key features:**
- Pure engines for fair price, toxicity, inventory skew, and quote calculation (no side effects)
- Strict risk controls: synchronous kill switches, exposure limits, stale-book guards
- Precise PnL attribution (spread capture, rebates, adverse selection, inventory mark-to-market)
- Decision tracing: every quote decision produces a structured diagnostic trace
- Latency arbitrage strategy for crypto prediction markets

## Quick Start

### Prerequisites

- Node.js >= 20.0.0
- npm

### Installation

```bash
git clone https://github.com/ualexzt/MM_Poly.git
cd MM_Poly
npm install
```

### Configuration

```bash
cp .env.example .env
# Edit .env with your Telegram bot token, chat ID, and other settings
```

### Build

```bash
npm run build
```

### Run Tests

```bash
npm run test            # Run all tests
npm run test:watch      # Watch mode
npm run test:coverage   # With coverage report
```

## Strategies

### Market Making (Rebate-Aware)

The primary strategy places symmetric bid/ask quotes on Polymarket prediction markets, capturing the spread and earning maker rebates while managing inventory risk.

```bash
npm run start:paper     # Simulated orders and fills only
npm run start:shadow    # Live data, real targets, no order placement
npm run start:live      # Real post-only orders (requires explicit config)
```

**Key config:** `MAX_MARKETS`, `MAX_EXPOSURE_USD`, `MAX_ORDER_SIZE_USD`, `MIN_SPREAD_TICKS`

### Latency Arbitrage

Exploits temporary mispricings between real-time crypto prices (from Binance) and Polymarket's implied probabilities in short-duration prediction markets. Detects strong directional moves using EMA crossovers and volume-confirmed momentum.

```bash
npm run start:latency-arb
```

**Key config:** `LATENCY_ARB_ENABLED`, `LATENCY_ARB_MIN_CONFIDENCE`, `LATENCY_ARB_MAX_POSITION_USD`

See [docs/latency-arbitrage.md](docs/latency-arbitrage.md) for full documentation.

## Project Structure

```
src/
├── engines/          # Pure logic (fair price, toxicity, inventory, quote, momentum, divergence)
├── strategy/         # Orchestration, config, market selection, latency arb strategy
├── risk/             # Guards and kill switches
├── accounting/       # PnL tracking and decision tracing
├── simulation/       # Paper execution models
├── data/             # API and WebSocket connectors (Polymarket, Binance)
├── execution/        # Order routing and management
├── monitoring/       # Health checks and metrics
├── notifier/         # Telegram notifications
├── reporting/        # Periodic status reports
├── scripts/          # Utility scripts (e.g., CLOB API key generation)
├── types/            # Shared type definitions
├── utils/            # Logger and helpers
├── run-paper.ts      # Paper mode entry point
├── run-shadow.ts     # Shadow mode entry point
├── run-small-live.ts # Small live mode entry point
├── run-latency-arb.ts # Latency arbitrage entry point
└── run.ts            # Generic entry point
```

## Module Boundaries

- `src/engines/`: Pure logic functions. Must have no side effects.
- `src/strategy/`: Orchestration and configuration.
- `src/risk/`: Guards and kill switches.
- `src/accounting/`: PnL tracking and structured decision tracing.
- `src/simulation/`: Paper execution models.
- `src/data/`: API and WebSocket connectors.

## Testing Conventions

- Every engine has an associated unit test (e.g., `tests/engines/fair-price-engine.test.ts`)
- Integration tests validate the complete end-to-end paper pipeline
- Runtime invariants have dedicated assertion tests (`tests/invariants/runtime.test.ts`)
- Never bypass risk checks to generate quotes faster

## Deployment

Production server:

```bash
ssh oraculus@46.225.147.43
cd /opt/polymarketmm
docker compose down && docker compose up --build -d
```

## License

Private — All rights reserved.
