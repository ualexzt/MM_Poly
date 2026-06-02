import { BookState } from '../../src/types/book';
import { MarketState } from '../../src/types/market';
import { AccumulatorConfig } from '../../src/engines/accumulator';
import { EqualizerConfig } from '../../src/engines/equalizer';
import { RiskConfig } from '../../src/risk/pair-cost-risk';
import { runAccumulatorCycle } from '../../src/strategy/accumulator-runner';
import { PositionTracker } from '../../src/strategy/position-tracker';

const ACCUMULATOR_CONFIG: AccumulatorConfig = {
  targetPairCost: 0.98,
  tradeSize: 2,
  maxUnhedgedDelta: 4,
  minLiquidityMultiplier: 3,
  maxExposurePerMarketUsd: 5,
};

const EQUALIZER_CONFIG: EqualizerConfig = {
  imbalanceThreshold: 1,
  tradeSize: 2,
  maxPairCost: 0.99,
};

const RISK_CONFIG: RiskConfig = {
  maxExposureUsd: 12,
  maxExposurePerMarketUsd: 5,
  maxDrawdownPct: 0.20,
  maxOpenOrders: 4,
  startingBalanceUsd: 15,
};

function makeMarket(overrides: Partial<MarketState> = {}): MarketState {
  return {
    conditionId: 'cid-1',
    slug: 'btc-updown-15m-1780390800',
    question: 'Bitcoin Up or Down',
    yesTokenId: 'yes-1',
    noTokenId: 'no-1',
    active: true,
    closed: false,
    enableOrderBook: true,
    feesEnabled: true,
    volume24hUsd: 1000,
    liquidityUsd: 500,
    oracleAmbiguityScore: 0.05,
    feeRate: 0.02,
    ...overrides,
  };
}

function ask(price: number, size: number) {
  return { price, size, sizeUsd: price * size };
}

function makeBook(overrides: Partial<BookState> = {}): BookState {
  const asks = overrides.asks ?? [];
  const bestAsk = overrides.bestAsk ?? (asks.length > 0 ? asks[0].price : null);
  const bestAskSizeUsd = overrides.bestAskSizeUsd ?? (asks.length > 0 ? asks[0].sizeUsd : 0);

  return {
    tokenId: 'token-1',
    conditionId: 'cid-1',
    bids: [],
    asks,
    bestBid: null,
    bestAsk,
    bestBidSizeUsd: 0,
    bestAskSizeUsd,
    midpoint: null,
    spread: null,
    spreadTicks: null,
    depth1Usd: 0,
    depth3Usd: 0,
    tickSize: 0.01,
    minOrderSize: 1,
    lastUpdateMs: Date.now(),
    ...overrides,
  };
}

function makeHarness(options: { markets?: MarketState[]; orderbooks?: Map<string, { yes: BookState; no: BookState }>; tracker?: PositionTracker; balance?: number } = {}) {
  const markets = options.markets ?? [makeMarket()];
  const orderbooks = options.orderbooks ?? new Map([
    ['cid-1', {
      yes: makeBook({ tokenId: 'yes-1', asks: [ask(0.42, 20)] }),
      no: makeBook({ tokenId: 'no-1', asks: [ask(0.52, 20)] }),
    }],
  ]);

  return {
    input: {
      marketScanner: { fetchMarkets: jest.fn().mockResolvedValue(markets) },
      orderbookClient: { fetchBook: jest.fn() },
      orderManager: {
        placeLimitOrder: jest.fn().mockResolvedValue({ orderId: 'o-1', status: 'LIVE' }),
        cancelStaleOrders: jest.fn().mockResolvedValue([]),
        getOpenOrders: jest.fn().mockResolvedValue([]),
      },
      logger: { write: jest.fn() },
      accumulatorConfig: ACCUMULATOR_CONFIG,
      equalizerConfig: EQUALIZER_CONFIG,
      riskConfig: RISK_CONFIG,
      currentBalanceUsd: options.balance ?? 15,
      tracker: options.tracker ?? new PositionTracker(),
      getOrderbooks: () => orderbooks,
      nowMs: () => 500,
      recordFillOnOrderPlacement: true,
      minOrderNotionalUsd: 0,
    },
  };
}

describe('runAccumulatorCycle', () => {
  it('places one accumulator order, sends share quantity, and records position like original Gabagool', async () => {
    const { input } = makeHarness();

    const result = await runAccumulatorCycle(input);

    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0].side).toBe('YES');
    expect(input.orderManager.placeLimitOrder).toHaveBeenCalledWith({
      tokenId: 'yes-1',
      side: 'BUY',
      price: 0.42,
      size: 2,
      postOnly: false,
    });
    expect(input.tracker.getPosition('cid-1')).toMatchObject({
      yesQty: 2,
      noQty: 0,
      avgYesPrice: 0.42,
    });
    expect(input.logger.write).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'accumulator_entry',
      sizeShares: 2,
      sizeUsd: 0.84,
    }));
  });

  it('logs order_failed and records no decision when execution fails', async () => {
    const { input } = makeHarness();
    input.recordFillOnOrderPlacement = false;
    input.orderManager.placeLimitOrder.mockResolvedValue({ orderId: null, status: 'ERROR', error: 'post-only would cross' });

    const result = await runAccumulatorCycle(input);

    expect(result.decisions).toHaveLength(0);
    expect(input.tracker.getPosition('cid-1')).toBeNull();
    expect(input.logger.write).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'order_failed',
      orderStatus: 'ERROR',
      error: 'post-only would cross',
    }));
  });

  it('upsizes live order when decision notional is below CLOB minimum', async () => {
    const { input } = makeHarness({
      orderbooks: new Map([
        ['cid-1', {
          yes: makeBook({ tokenId: 'yes-1', asks: [ask(0.25, 20)] }),
          no: makeBook({ tokenId: 'no-1', asks: [ask(0.80, 20)] }),
        }],
      ]),
    });
    input.recordFillOnOrderPlacement = false;
    input.accumulatorConfig = { ...ACCUMULATOR_CONFIG, minOrderNotionalUsd: 1 };

    const result = await runAccumulatorCycle(input);

    // 2 shares × 0.25 = 0.50 < 1 → upsize to ceil(1/0.25) = 4 shares
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0].side).toBe('YES');
    expect(result.decisions[0].sizeShares).toBe(4);
    expect(result.decisions[0].sizeUsd).toBe(1);
    expect(input.orderManager.placeLimitOrder).toHaveBeenCalledWith({
      tokenId: 'yes-1',
      side: 'BUY',
      price: 0.25,
      size: 4,
      postOnly: false,
    });
  });

  it('skips when upsizing capped by delta leaves notional below minimum', async () => {
    const { input } = makeHarness({
      orderbooks: new Map([
        ['cid-1', {
          yes: makeBook({ tokenId: 'yes-1', asks: [ask(0.13, 20)] }),
          no: makeBook({ tokenId: 'no-1', asks: [ask(0.80, 20)] }),
        }],
      ]),
    });
    input.recordFillOnOrderPlacement = false;
    input.accumulatorConfig = { ...ACCUMULATOR_CONFIG, minOrderNotionalUsd: 1 };

    const result = await runAccumulatorCycle(input);

    // upsized to ceil(1/0.13) = 8, delta capped at 4 → 4 × 0.13 = 0.52 < 1 → SKIP
    expect(result.decisions).toHaveLength(0);
    expect(input.orderManager.placeLimitOrder).not.toHaveBeenCalled();
  });

  it('does not record fill on order placement when configured for live execution', async () => {
    const { input } = makeHarness();
    input.recordFillOnOrderPlacement = false;

    const result = await runAccumulatorCycle(input);

    expect(result.decisions).toHaveLength(1);
    expect(input.orderManager.placeLimitOrder).toHaveBeenCalledTimes(1);
    expect(input.tracker.getPosition('cid-1')).toBeNull();
  });

  it('prioritizes equalizer when existing position is imbalanced', async () => {
    const tracker = new PositionTracker();
    tracker.updateFill('cid-1', 'YES', 0.13, 4);
    const { input } = makeHarness({
      tracker,
      orderbooks: new Map([
        ['cid-1', {
          yes: makeBook({ tokenId: 'yes-1', asks: [ask(0.10, 20)] }),
          no: makeBook({ tokenId: 'no-1', asks: [ask(0.70, 20)] }),
        }],
      ]),
    });

    const result = await runAccumulatorCycle(input);

    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0].side).toBe('NO');
    expect(input.orderManager.placeLimitOrder).toHaveBeenCalledWith(expect.objectContaining({
      tokenId: 'no-1',
      price: 0.70,
      size: 2,
    }));
    expect(input.tracker.getPosition('cid-1')).toMatchObject({
      yesQty: 4,
      noQty: 2,
      avgNoPrice: 0.70,
    });
  });

  it('closes expired positions before risk check so new 15-minute market can trade', async () => {
    const tracker = new PositionTracker();
    tracker.updateFill('expired', 'YES', 0.45, 10, 1_000);
    tracker.updateFill('expired', 'NO', 0.50, 10, 1_000);
    const { input } = makeHarness({ tracker });
    input.nowMs = () => 1_001;

    const result = await runAccumulatorCycle(input);

    expect(input.logger.write).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'market_expired',
      marketId: 'expired',
      exposureUsd: 9.5,
    }));
    expect(tracker.getPosition('expired')).toBeNull();
    expect(result.decisions).toHaveLength(1);
    expect(input.orderManager.placeLimitOrder).toHaveBeenCalled();
  });

  it('stores current market end time with paper fills', async () => {
    const market = makeMarket({ endDate: new Date(2_000).toISOString() });
    const { input } = makeHarness({ markets: [market] });

    await runAccumulatorCycle(input);

    expect(input.tracker.getPosition('cid-1')?.marketEndMs).toBe(2_000);
  });

  it('skips when risk check fails', async () => {
    const { input } = makeHarness({ balance: 5 });

    await runAccumulatorCycle(input);

    expect(input.orderManager.placeLimitOrder).not.toHaveBeenCalled();
    expect(input.logger.write).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'risk_blocked',
    }));
  });

  it('logs cycle_error when market fetch fails', async () => {
    const { input } = makeHarness();
    input.marketScanner.fetchMarkets.mockRejectedValue(new Error('timeout'));

    const result = await runAccumulatorCycle(input);

    expect(result.decisions).toEqual([]);
    expect(input.logger.write).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'cycle_error',
    }));
  });
});
