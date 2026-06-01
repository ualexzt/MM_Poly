# Latency Arbitrage Strategy

## Overview

The Latency Arbitrage strategy exploits temporary mispricings between real-time crypto prices (from Binance) and Polymarket's implied probabilities in 5m/15m prediction markets.

It streams live BTC/ETH price data from Binance via WebSocket, detects strong directional moves using EMA crossovers and volume-confirmed momentum, and calculates whether Polymarket prices have diverged from the momentum-implied fair value. When divergence exceeds configurable thresholds and confidence is sufficient, the strategy buys YES or NO outcome tokens.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Binance WS     │────▶│  Momentum Engine  │────▶│  Divergence     │
│  Price Feed      │     │  (EMA + volume)   │     │  Engine          │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                           │
                                                           ▼
                                                  ┌─────────────────┐
                                                  │  LatencyArb     │
                                                  │  Strategy        │
                                                  │  (confidence,    │
                                                  │   risk, trade)   │
                                                  └─────────────────┘
```

### Components

| Component | Location | Purpose |
|-----------|----------|---------|
| **BinanceWsFeed** | `src/data/binance-ws-feed.ts` | Streams real-time BTC/ETH prices from Binance WebSocket |
| **MomentumEngine** | `src/engines/momentum-engine.ts` | Detects directional moves using EMA crossovers and price change thresholds |
| **DivergenceEngine** | `src/engines/divergence-engine.ts` | Pure function: compares momentum-implied probability with market prices |
| **LatencyArbStrategy** | `src/strategy/latency-arb-strategy.ts` | Orchestrates feed, engines, risk checks, and trade recording |
| **LatencyArbConfig** | `src/strategy/latency-arb-config.ts` | Typed defaults for all strategy parameters |

## How It Works

1. **Price Feed**: Streams real-time BTC/ETH prices from Binance via WebSocket
2. **Momentum Detection**: The `MomentumEngine` maintains a rolling window of price points and computes:
   - Fast EMA (5-period) and Slow EMA (20-period) crossovers
   - Price change percentage over the lookback window (default 60s)
   - Volume confirmation (recent volume >= 1.5x average)
3. **Divergence Calculation**: The `DivergenceEngine` converts momentum into an implied probability and compares it to the Polymarket YES/NO price:
   - Implied probability is derived from momentum strength, volume confirmation, and EMA trend
   - Divergence = (implied_probability - entry_price) / entry_price × 100
   - Expected Value = implied_probability × $1 payout - entry_price
4. **Trade Decision**: Buys YES (if bullish) or NO (if bearish) when:
   - Divergence >= `minDivergencePct` (default 3%)
   - Expected value >= `minEvPct` (default 2%)
   - Confidence >= `minConfidence` (default 0.6)
   - Entry price within allowed range (0.20–0.70)

## Configuration

### Environment Variables

| Parameter | Default | Description |
|-----------|---------|-------------|
| `LATENCY_ARB_ENABLED` | `false` | Enable/disable the latency arbitrage strategy |
| `LATENCY_ARB_MIN_CONFIDENCE` | `0.6` | Minimum confidence score to execute a trade (0–1) |
| `LATENCY_ARB_MAX_POSITION_USD` | `50` | Maximum position size in USD |
| `LATENCY_ARB_MAX_DAILY_TRADES` | `20` | Maximum number of trades per day |
| `LATENCY_ARB_COOLDOWN_MS` | `60000` | Minimum cooldown between trades in milliseconds |
| `BINANCE_SYMBOLS` | `btcusdt,ethusdt` | Comma-separated Binance symbols to stream |
| `MODE` | `paper` | Execution mode: `paper`, `shadow`, or `small_live` |

### Internal Defaults (latency-arb-config.ts)

| Parameter | Default | Description |
|-----------|---------|-------------|
| `lookbackSeconds` | `60` | Rolling window for momentum analysis |
| `minPriceChangePct` | `0.5` | Minimum price change (%) to trigger momentum signal |
| `minVolumeMultiplier` | `1.5` | Recent volume must exceed average × this multiplier for confirmation |
| `emaFastPeriod` | `5` | Fast EMA period |
| `emaSlowPeriod` | `20` | Slow EMA period |
| `minDivergencePct` | `3.0` | Minimum divergence (%) between implied probability and market price |
| `minEvPct` | `2.0` | Minimum expected value (%) to consider a trade |
| `maxEntryPrice` | `0.70` | Maximum allowed entry price (avoids buying near certainty) |
| `minEntryPrice` | `0.20` | Minimum allowed entry price (avoids buying near zero) |

## Running

```bash
# Paper mode (default — simulated fills only)
npm run start:latency-arb

# With custom config via environment
LATENCY_ARB_ENABLED=true \
LATENCY_ARB_MIN_CONFIDENCE=0.7 \
LATENCY_ARB_MAX_DAILY_TRADES=10 \
npm run start:latency-arb

# In shadow mode (live data, no order placement)
MODE=shadow LATENCY_ARB_ENABLED=true npm run start:latency-arb
```

> **Note:** `LATENCY_ARB_ENABLED=true` must be set or the process exits immediately.

## Risk Management

- **Position limits**: `LATENCY_ARB_MAX_POSITION_USD` caps exposure per position
- **Daily trade limits**: `LATENCY_ARB_MAX_DAILY_TRADES` prevents overtrading
- **Cooldown**: `LATENCY_ARB_COOLDOWN_MS` enforces a minimum gap between trades
- **Confidence threshold**: Only trades with confidence >= `minConfidence` are executed
- **Entry price range**: Avoids buying tokens near 0 or 1 (0.20–0.70 range by default)
- **Momentum confirmation**: Requires both price change and volume to confirm the move
- **Conservative probability cap**: Implied probability is capped at 0.85 to avoid overconfidence

## Testing

```bash
# Run latency arbitrage related tests
npx jest --testPathPattern='latency|momentum|divergence'

# Run all tests
npm test
```

## Future Improvements

- Multi-timeframe momentum confirmation (5m + 15m)
- Dynamic position sizing based on confidence
- Integration with Polymarket order book depth for better fills
- Backtesting framework with historical Binance data
- Spread-aware entry timing
