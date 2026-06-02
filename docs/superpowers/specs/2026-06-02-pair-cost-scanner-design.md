# Pair-Cost Scanner Design

## Problem
Find binary Polymarket markets where buying YES + NO together costs less than $1 after fees.

If `bestAskYES + bestAskNO + fees < 1.00`, the paired position pays $1 at resolution regardless of outcome → locked profit.

## Architecture

Two modules plus CLI runner:

1. `src/engines/pair-cost-scanner.ts` — pure engine, no I/O
2. `src/strategy/pair-cost-runner.ts` — side-effectful runner wiring real clients
3. `src/run-pair-cost.ts` — CLI entrypoint

## Types

```typescript
interface PairCostConfig {
  maxPairCost: number;        // default 0.99
  minEdgeBps: number;         // default 50 (0.5%)
  minLiquidityUsd: number;    // default 10
  feeRate: number;            // default 0.02 (2% taker fee)
}

interface PairCostOpportunity {
  conditionId: string;
  slug: string;
  question: string;
  yesPrice: number;
  noPrice: number;
  rawCost: number;            // yes + no
  allInCost: number;          // rawCost * (1 + feeRate)
  edgeBps: number;            // (1 - allInCost) * 10000
  maxSizeUsd: number;         // min(yesAskSizeUsd, noAskSizeUsd)
}
```

## Pure Engine

```typescript
function calculatePairCost(yesPrice: number, noPrice: number, feeRate: number): number
function scanPairCostOpportunities(markets, orderbooks, config): PairCostOpportunity[]
```

## Fee Model

All-in cost = `(yesPrice + noPrice) * (1 + feeRate)`. Default feeRate = 0.02.

## Scan Flow

1. Fetch active markets from Gamma
2. Filter: active, not closed, enableOrderBook, has both token IDs
3. Fetch YES + NO orderbooks per market (parallel)
4. Compute allInCost per market
5. If allInCost < maxPairCost AND edgeBps >= minEdgeBps → log opportunity
6. Log via JSONL writer

## Paper Mode

No order placement. Log `pair_opportunity` events only. Runner loops with configurable interval.
