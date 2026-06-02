import { BookState } from '../../src/types/book';
import {
  DEFAULT_PAIR_COST_STRATEGY_CONFIG,
  InventoryLot,
  PairCostSkipReason,
  PairCostState,
  PairCostStrategyConfig,
  PairCostStrategyOrder,
} from '../../src/engines/pair-cost-types';
import {
  applyPairCostFillAndManageOrder,
  decidePairCostStrategyTick,
} from '../../src/engines/pair-cost-strategy';

const NOW = new Date('2026-01-01T00:00:10.000Z');

function enabledConfig(overrides: Partial<PairCostStrategyConfig> = {}): PairCostStrategyConfig {
  return {
    ...DEFAULT_PAIR_COST_STRATEGY_CONFIG,
    enabled: true,
    maxSingleOrderUsd: 20,
    maxTotalMarketExposureUsd: 50,
    maxUnpairedExposureUsd: 20,
    minDepthUsd: 1,
    maxSpread: 0.04,
    ...overrides,
  };
}

function lot(overrides: Partial<InventoryLot>): InventoryLot {
  return {
    id: overrides.id ?? 'lot-1',
    marketId: overrides.marketId ?? 'market-1',
    side: overrides.side ?? 'YES',
    qty: overrides.qty ?? 1,
    remainingQty: overrides.remainingQty ?? overrides.qty ?? 1,
    price: overrides.price ?? 0.5,
    cost: overrides.cost ?? (overrides.remainingQty ?? overrides.qty ?? 1) * (overrides.price ?? 0.5),
    timestamp: overrides.timestamp ?? new Date('2026-01-01T00:00:00.000Z'),
    sourceOrderId: overrides.sourceOrderId ?? null,
  };
}

function book(overrides: Partial<BookState> = {}): BookState {
  return {
    tokenId: overrides.tokenId ?? 'token-1',
    conditionId: 'market-1',
    bids: [{ price: 0.50, size: 20, sizeUsd: 10 }],
    asks: [{ price: 0.53, size: 20, sizeUsd: 10.6 }],
    bestBid: 0.50,
    bestAsk: 0.53,
    bestBidSizeUsd: 10,
    bestAskSizeUsd: 10.6,
    midpoint: 0.515,
    spread: 0.03,
    spreadTicks: 3,
    depth1Usd: 10,
    depth3Usd: 10,
    tickSize: 0.01,
    minOrderSize: 1,
    lastUpdateMs: NOW.getTime(),
    ...overrides,
  };
}

function decisionInput(overrides: Partial<Parameters<typeof decidePairCostStrategyTick>[0]> = {}): Parameters<typeof decidePairCostStrategyTick>[0] {
  return {
    marketId: 'market-1',
    config: enabledConfig(),
    lots: [],
    books: {
      YES: book({ tokenId: 'yes-1' }),
      NO: book({ tokenId: 'no-1' }),
    },
    now: NOW,
    timeToCloseSeconds: 3600,
    market: { enabled: true, closed: false, resolving: false },
    currentMarketExposureUsd: 0,
    ...overrides,
  };
}

describe('decidePairCostStrategyTick', () => {
  it('is disabled by default and skips with a machine-readable reason', () => {
    const result = decidePairCostStrategyTick(decisionInput({
      config: DEFAULT_PAIR_COST_STRATEGY_CONFIG,
    }));

    expect(result.decision).toBe('SKIP');
    expect(result.reason).toBe(PairCostSkipReason.STRATEGY_DISABLED);
    expect(result.order).toBeNull();
    expect(result.log).toEqual(expect.objectContaining({
      strategy: 'pair_cost',
      decision: 'SKIP',
      reason: PairCostSkipReason.STRATEGY_DISABLED,
    }));
  });

  it('buys NO only to hedge existing unpaired YES when projected pair cost is acceptable', () => {
    const result = decidePairCostStrategyTick(decisionInput({
      lots: [lot({ id: 'yes-unpaired', side: 'YES', qty: 10, remainingQty: 10, price: 0.45 })],
      books: {
        YES: book({ tokenId: 'yes-1', asks: [{ price: 0.20, size: 10, sizeUsd: 2 }], bestAsk: 0.20 }),
        NO: book({ tokenId: 'no-1', asks: [{ price: 0.53, size: 10, sizeUsd: 5.3 }], bestAsk: 0.53 }),
      },
    }));

    expect(result.decision).toBe('PLACE_ORDER');
    expect(result.reason).toBe('HEDGE_COMPLETION');
    expect(result.order).toEqual(expect.objectContaining({
      marketId: 'market-1',
      action: 'BUY',
      side: 'NO',
      qty: 10,
      limitPrice: 0.53,
      purpose: 'HEDGE_COMPLETION',
      expectedPairCost: 0.98,
    }));
    expect(result.log).toEqual(expect.objectContaining({
      candidateAction: 'BUY',
      candidateSide: 'NO',
      candidateQty: 10,
      candidateExecPrice: 0.53,
      projectedPairCost: 0.98,
      edgePerPair: 0.02,
    }));
  });

  it('rejects expensive BUY NO hedge when pair cost exceeds max_pair_cost', () => {
    const result = decidePairCostStrategyTick(decisionInput({
      lots: [lot({ id: 'yes-unpaired', side: 'YES', qty: 10, remainingQty: 10, price: 0.45 })],
      books: {
        YES: book({ tokenId: 'yes-1', asks: [{ price: 0.20, size: 10, sizeUsd: 2 }], bestAsk: 0.20 }),
        NO: book({ tokenId: 'no-1', asks: [{ price: 0.55, size: 10, sizeUsd: 5.5 }], bestAsk: 0.55 }),
      },
    }));

    expect(result.decision).toBe('SKIP');
    expect(result.reason).toBe(PairCostSkipReason.PAIR_COST_TOO_HIGH);
    expect(result.order).toBeNull();
    expect(result.log.projectedPairCost).toBe(1.00);
  });

  it('buys YES only to hedge existing unpaired NO when projected pair cost is acceptable', () => {
    const result = decidePairCostStrategyTick(decisionInput({
      lots: [lot({ id: 'no-unpaired', side: 'NO', qty: 10, remainingQty: 10, price: 0.45 })],
      books: {
        YES: book({ tokenId: 'yes-1', asks: [{ price: 0.53, size: 10, sizeUsd: 5.3 }], bestAsk: 0.53 }),
        NO: book({ tokenId: 'no-1', asks: [{ price: 0.20, size: 10, sizeUsd: 2 }], bestAsk: 0.20 }),
      },
    }));

    expect(result.decision).toBe('PLACE_ORDER');
    expect(result.order).toEqual(expect.objectContaining({
      action: 'BUY',
      side: 'YES',
      qty: 10,
      expectedPairCost: 0.98,
    }));
  });

  it('never buys more YES while YES is already unpaired', () => {
    const result = decidePairCostStrategyTick(decisionInput({
      lots: [lot({ id: 'yes-unpaired', side: 'YES', qty: 10, remainingQty: 10, price: 0.45 })],
      books: {
        YES: book({ tokenId: 'yes-1', asks: [{ price: 0.01, size: 100, sizeUsd: 1 }], bestAsk: 0.01 }),
        NO: book({ tokenId: 'no-1', asks: [{ price: 0.55, size: 10, sizeUsd: 5.5 }], bestAsk: 0.55 }),
      },
    }));

    expect(result.decision).toBe('SKIP');
    expect(result.reason).toBe(PairCostSkipReason.PAIR_COST_TOO_HIGH);
    expect(result.order).toBeNull();
    expect(result.log.candidateSide).toBe('NO');
  });

  it('rejects blended-average hedge that would leave newly bought NO unpaired at lot level', () => {
    const result = decidePairCostStrategyTick(decisionInput({
      lots: [
        lot({ id: 'yes-cheap', side: 'YES', qty: 5, remainingQty: 5, price: 0.10 }),
        lot({ id: 'yes-expensive', side: 'YES', qty: 5, remainingQty: 5, price: 0.80 }),
      ],
      books: {
        YES: book({ tokenId: 'yes-1' }),
        NO: book({ tokenId: 'no-1', asks: [{ price: 0.50, size: 10, sizeUsd: 5 }], bestAsk: 0.50 }),
      },
    }));

    expect(result.decision).toBe('SKIP');
    expect(result.reason).toBe(PairCostSkipReason.PAIR_COST_TOO_HIGH);
    expect(result.order).toBeNull();
  });

  it('uses executable levels, not only executable average, to reject partially unprofitable hedge fills', () => {
    const result = decidePairCostStrategyTick(decisionInput({
      lots: [lot({ id: 'yes-unpaired', side: 'YES', qty: 10, remainingQty: 10, price: 0.45 })],
      books: {
        YES: book({ tokenId: 'yes-1' }),
        NO: book({
          tokenId: 'no-1',
          asks: [
            { price: 0.50, size: 5, sizeUsd: 2.5 },
            { price: 0.55, size: 5, sizeUsd: 2.75 },
          ],
          bestAsk: 0.50,
          depth3Usd: 5.25,
        }),
      },
    }));

    expect(result.log.projectedPairCost).toBe(0.975);
    expect(result.decision).toBe('SKIP');
    expect(result.reason).toBe(PairCostSkipReason.PAIR_COST_TOO_HIGH);
    expect(result.order).toBeNull();
  });

  it('does not buy either side when both sides already have unpaired lots', () => {
    const result = decidePairCostStrategyTick(decisionInput({
      lots: [
        lot({ id: 'yes-unpaired', side: 'YES', qty: 5, remainingQty: 5, price: 0.90 }),
        lot({ id: 'no-unpaired', side: 'NO', qty: 5, remainingQty: 5, price: 0.90 }),
      ],
      books: {
        YES: book({ tokenId: 'yes-1', asks: [{ price: 0.01, size: 5, sizeUsd: 0.05 }], bestAsk: 0.01 }),
        NO: book({ tokenId: 'no-1', asks: [{ price: 0.01, size: 5, sizeUsd: 0.05 }], bestAsk: 0.01 }),
      },
    }));

    expect(result.decision).toBe('SKIP');
    expect(result.reason).toBe(PairCostSkipReason.REDUCE_ONLY);
    expect(result.order).toBeNull();
  });

  it('skips instead of creating a zero-size hedge order when target asks are empty', () => {
    const result = decidePairCostStrategyTick(decisionInput({
      lots: [lot({ id: 'yes-unpaired', side: 'YES', qty: 10, remainingQty: 10, price: 0.45 })],
      books: {
        YES: book({ tokenId: 'yes-1' }),
        NO: book({ tokenId: 'no-1', asks: [], bestAsk: null, depth3Usd: 0 }),
      },
    }));

    expect(result.decision).toBe('SKIP');
    expect(result.reason).toBe(PairCostSkipReason.DEPTH_TOO_LOW);
    expect(result.order).toBeNull();
  });

  it('does not open first-leg inventory when probe mode is disabled', () => {
    const result = decidePairCostStrategyTick(decisionInput({ lots: [] }));

    expect(result.decision).toBe('SKIP');
    expect(result.reason).toBe(PairCostSkipReason.PROBE_DISABLED);
    expect(result.order).toBeNull();
  });

  it('enforces probe exposure cap when probe mode is explicitly enabled', () => {
    const result = decidePairCostStrategyTick(decisionInput({
      config: enabledConfig({ probeEnabled: true, allowProbeMode: true, maxProbeExposureUsd: 0.50 }),
      probeCandidate: { side: 'YES', qty: 2, limitPrice: 0.45, mispricing: 0.05 },
    }));

    expect(result.decision).toBe('SKIP');
    expect(result.reason).toBe(PairCostSkipReason.MAX_UNPAIRED_EXPOSURE_REACHED);
    expect(result.order).toBeNull();
  });

  it('rejects zero-quantity probe orders', () => {
    const result = decidePairCostStrategyTick(decisionInput({
      config: enabledConfig({ probeEnabled: true, allowProbeMode: true }),
      probeCandidate: { side: 'YES', qty: 0, limitPrice: 0.45, mispricing: 0.05 },
    }));

    expect(result.decision).toBe('SKIP');
    expect(result.reason).toBe(PairCostSkipReason.DEPTH_TOO_LOW);
    expect(result.order).toBeNull();
  });

  it('enforces spread guard before probe orders', () => {
    const result = decidePairCostStrategyTick(decisionInput({
      config: enabledConfig({ probeEnabled: true, allowProbeMode: true, maxSpread: 0.04 }),
      books: {
        YES: book({ spread: 0.05 }),
        NO: book({ spread: 0.03 }),
      },
      probeCandidate: { side: 'YES', qty: 1, limitPrice: 0.20, mispricing: 0.05 },
    }));

    expect(result.decision).toBe('SKIP');
    expect(result.reason).toBe(PairCostSkipReason.SPREAD_TOO_WIDE);
    expect(result.order).toBeNull();
  });

  it('enforces total market exposure cap before probe orders', () => {
    const result = decidePairCostStrategyTick(decisionInput({
      config: enabledConfig({
        probeEnabled: true,
        allowProbeMode: true,
        maxProbeExposureUsd: 5,
        maxTotalMarketExposureUsd: 1,
      }),
      currentMarketExposureUsd: 0.9,
      probeCandidate: { side: 'YES', qty: 1, limitPrice: 0.20, mispricing: 0.05 },
    }));

    expect(result.decision).toBe('SKIP');
    expect(result.reason).toBe(PairCostSkipReason.MAX_MARKET_EXPOSURE_REACHED);
    expect(result.order).toBeNull();
  });

  it('skips and places no order when either orderbook is stale', () => {
    const result = decidePairCostStrategyTick(decisionInput({
      lots: [lot({ side: 'YES', qty: 10, remainingQty: 10, price: 0.45 })],
      books: {
        YES: book({ lastUpdateMs: NOW.getTime() - 2000 }),
        NO: book({ lastUpdateMs: NOW.getTime() }),
      },
      config: enabledConfig({ orderbookStaleMs: 1500 }),
    }));

    expect(result.decision).toBe('SKIP');
    expect(result.reason).toBe(PairCostSkipReason.ORDERBOOK_STALE);
    expect(result.order).toBeNull();
  });

  it('enforces time-to-close guard before hedge orders', () => {
    const result = decidePairCostStrategyTick(decisionInput({
      lots: [lot({ side: 'YES', qty: 10, remainingQty: 10, price: 0.45 })],
      timeToCloseSeconds: 30,
      config: enabledConfig({ noNewPairLastSeconds: 60 }),
    }));

    expect(result.decision).toBe('SKIP');
    expect(result.reason).toBe(PairCostSkipReason.TIME_TO_CLOSE_TOO_LOW);
    expect(result.order).toBeNull();
  });

  it('enters reduce-only after unpaired inventory exceeds max hold and hedge is not profitable', () => {
    const result = decidePairCostStrategyTick(decisionInput({
      lots: [lot({
        id: 'old-yes',
        side: 'YES',
        qty: 10,
        remainingQty: 10,
        price: 0.45,
        timestamp: new Date(NOW.getTime() - 31_000),
      })],
      books: {
        YES: book({ tokenId: 'yes-1' }),
        NO: book({ tokenId: 'no-1', asks: [{ price: 0.55, size: 10, sizeUsd: 5.5 }], bestAsk: 0.55 }),
      },
      config: enabledConfig({ maxUnpairedHoldSeconds: 30, reduceOnlyOnTimeout: true }),
    }));

    expect(result.decision).toBe('SKIP');
    expect(result.reason).toBe(PairCostSkipReason.REDUCE_ONLY);
    expect(result.log.state).toBe(PairCostState.REDUCE_ONLY);
  });

  it('does not place a second strategy order while one active order exists', () => {
    const activeOrder: PairCostStrategyOrder = {
      orderId: 'order-1',
      marketId: 'market-1',
      side: 'NO',
      action: 'BUY',
      qty: 10,
      limitPrice: 0.53,
      createdAt: NOW,
      purpose: 'HEDGE_COMPLETION',
      expectedPairCost: 0.98,
      status: 'OPEN',
    };

    const result = decidePairCostStrategyTick(decisionInput({
      lots: [lot({ side: 'YES', qty: 10, remainingQty: 10, price: 0.45 })],
      activeOrder,
    }));

    expect(result.decision).toBe('SKIP');
    expect(result.reason).toBe(PairCostSkipReason.ACTIVE_ORDER_EXISTS);
    expect(result.order).toBeNull();
  });

  it('cancels aged active order instead of blocking forever', () => {
    const activeOrder: PairCostStrategyOrder = {
      orderId: 'order-1',
      marketId: 'market-1',
      side: 'NO',
      action: 'BUY',
      qty: 10,
      limitPrice: 0.53,
      createdAt: new Date(NOW.getTime() - 2000),
      purpose: 'HEDGE_COMPLETION',
      expectedPairCost: 0.98,
      status: 'OPEN',
    };

    const result = decidePairCostStrategyTick(decisionInput({
      lots: [lot({ side: 'YES', qty: 10, remainingQty: 10, price: 0.45 })],
      activeOrder,
      config: enabledConfig({ partialFillTimeoutMs: 1500 }),
    }));

    expect(result.decision).toBe('CANCEL_ORDER');
    expect(result.reason).toBe(PairCostSkipReason.ACTIVE_ORDER_EXISTS);
    expect(result.order).toBeNull();
    expect(result.cancelOrderId).toBe('order-1');
  });

  it('cancels aged active order even when orderbooks are stale', () => {
    const activeOrder: PairCostStrategyOrder = {
      orderId: 'order-stale',
      marketId: 'market-1',
      side: 'NO',
      action: 'BUY',
      qty: 10,
      limitPrice: 0.53,
      createdAt: new Date(NOW.getTime() - 2000),
      purpose: 'HEDGE_COMPLETION',
      expectedPairCost: 0.98,
      status: 'OPEN',
    };

    const result = decidePairCostStrategyTick(decisionInput({
      lots: [lot({ side: 'YES', qty: 10, remainingQty: 10, price: 0.45 })],
      activeOrder,
      books: {
        YES: book({ lastUpdateMs: NOW.getTime() - 2000 }),
        NO: book({ lastUpdateMs: NOW.getTime() - 2000 }),
      },
      config: enabledConfig({ partialFillTimeoutMs: 1500, orderbookStaleMs: 1000 }),
    }));

    expect(result.decision).toBe('CANCEL_ORDER');
    expect(result.cancelOrderId).toBe('order-stale');
  });
});

describe('applyPairCostFillAndManageOrder', () => {
  it('rebuilds inventory after partial fill and expires/cancels unfilled remainder after timeout', () => {
    const activeOrder: PairCostStrategyOrder = {
      orderId: 'hedge-order-1',
      marketId: 'market-1',
      side: 'NO',
      action: 'BUY',
      qty: 10,
      limitPrice: 0.53,
      createdAt: NOW,
      purpose: 'HEDGE_COMPLETION',
      expectedPairCost: 0.98,
      status: 'OPEN',
    };

    const result = applyPairCostFillAndManageOrder({
      marketId: 'market-1',
      lots: [lot({ id: 'yes-unpaired', side: 'YES', qty: 10, remainingQty: 10, price: 0.45 })],
      activeOrder,
      fill: { qty: 4, price: 0.53, timestamp: new Date(NOW.getTime() + 500) },
      now: new Date(NOW.getTime() + 2000),
      config: enabledConfig({ partialFillTimeoutMs: 1500 }),
    });

    expect(result.inventoryState.pairedQty).toBe(4);
    expect(result.inventoryState.profitablePairs).toHaveLength(1);
    expect(result.inventoryState.unpairedYesQty).toBe(6);
    expect(result.order).toEqual(expect.objectContaining({
      status: 'CANCELLED',
    }));
    expect(result.cancelRemaining).toBe(true);
  });
});
