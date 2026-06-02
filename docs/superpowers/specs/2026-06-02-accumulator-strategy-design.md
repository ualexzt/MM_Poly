# Pair-Cost Accumulator Strategy — Full Design

## Strategy

Original Gabagool logic adapted for $15 deposit:

1. **Accumulator**: Buy the cheaper side via limit order when pair cost opportunity exists
2. **Equalizer**: Rebalance directional exposure by buying the lagging side
3. **Profit**: At resolution, receive $1 for each YES+NO pair. Profit = $1 - avg pair cost

## Architecture

### Pure Engines (no I/O)

**Accumulator Engine** — `src/engines/accumulator.ts`
- Input: current position, orderbooks, config
- Output: decision (BUY YES / BUY NO / SKIP) with limit price and size
- Logic:
  - Empty position → buy cheaper side
  - Has one side → buy other side if `ask_other + avg_held < targetCost`
  - Both sides → check if can improve avg by adding more of cheaper side
  - Per-market exposure limit check

**Equalizer Engine** — `src/engines/equalizer.ts`
- Input: current position, orderbooks, config
- Output: decision (BUY YES / BUY NO / BALANCED)
- Logic:
  - If `|yesQty - noQty| > threshold` → buy the smaller side
  - Threshold = config.minEqualizerImbalance (default: 1 unit)

### Stateful Components

**Position Tracker** — `src/strategy/position-tracker.ts`
- Track per-market: yesQty, noQty, avgYesPrice, avgNoPrice, totalCostUsd
- Methods: updateFill(), getAvgPairCost(), getUnrealizedPnl(), getAllPositions()

**Order Manager** — `src/execution/order-manager.ts`
- Place limit orders via Polymarket CLOB API
- Cancel stale orders (configurable lifetime)
- Track open orders
- Uses `@polymarket/clob-client-v2` for signing

**Risk Engine** — `src/risk/pair-cost-risk.ts`
- Max total exposure: $12 (of $15)
- Max per-market exposure: $5
- Max drawdown: 20%
- Max open orders: 4
- Check before any order placement

### Runner

**Accumulator Runner** — `src/strategy/accumulator-runner.ts`
- One cycle: fetch markets → fetch orderbooks → decide → place/cancel → log
- Injected dependencies (scanner, orderbook client, position tracker, order manager, logger)

**CLI** — `src/run-accumulator.ts`
- Creates real clients, runs loop every 30s
- Paper mode: log decisions only, no orders
- Shadow mode: compute decisions, log, no orders
- Live mode: place real limit orders (requires explicit flag)

## Fee Model

Polymarket taker fee: ~2% per leg
Maker fee: ~0% (may get rebate)
Limit orders = maker → no taker fee on placement
Fill happens when market price crosses limit → maker fill

All-in cost for limit orders: just the limit prices (no taker fee)
Profit = $1 - avgYesPrice - avgNoPrice

## Config for $15

```typescript
{
  maxPairCost: 0.98,           // target: pair must cost < this
  minEdgeBps: 100,             // 1% minimum edge
  maxExposureUsd: 12,          // keep $3 reserve
  maxExposurePerMarketUsd: 5,  // $5 per market max
  maxMarkets: 3,               // 3 markets simultaneously
  limitOrderOffsetCents: 1,    // 1 cent below ask
  orderLifetimeMs: 60_000,     // cancel after 60s if not filled
  equalizerImbalanceThreshold: 1, // rebalance when qty differs by >1
}
```

## Order Flow

1. Accumulator decides: BUY YES at $0.45, size $3
2. Order Manager places limit order via CLOB API
3. Order sits in book until filled or cancelled
4. Position Tracker updates on fill
5. Next cycle: Equalizer checks if rebalancing needed
6. If YES filled but NO not → Equalizer places NO limit order
7. When both sides filled → pair locked, wait for resolution

## Paper Mode

- Scanner finds opportunities
- Accumulator/Equalizer make decisions
- Log decisions to JSONL
- NO real orders placed
- Simulate fills based on observed trades (optional)

## Testing

TDD for each module:
1. Accumulator engine — pure tests with fixtures
2. Equalizer engine — pure tests with fixtures
3. Position tracker — stateful but no I/O
4. Risk engine — pure checks
5. Order manager — mock CLOB client
6. Runner — integration with all mocks
