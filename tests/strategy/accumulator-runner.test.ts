import { BookState } from '../../src/types/book';
import { MarketState } from '../../src/types/market';
import { AccumulatorConfig } from '../../src/engines/accumulator';
import { EqualizerConfig } from '../../src/engines/equalizer';
import { RiskConfig } from '../../src/risk/pair-cost-risk';
import { runAccumulatorCycle } from '../../src/strategy/accumulator-runner';

const ACCUMULATOR_CONFIG: AccumulatorConfig = {
  maxPairCost: 0.98,
  minEdgeBps: 100,
  maxExposurePerMarketUsd: 5,
  limitOrderOffsetCents: 1,
};

const EQUALIZER_CONFIG: EqualizerConfig = {
  imbalanceThreshold: 1,
  maxExposurePerMarketUsd: 5,
  limitOrderOffsetCents: 1,
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
    slug: 'test-market',
    question: 'Will X happen?',
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

function makeBook(overrides: Partial<BookState> = {}): BookState {
  return {
    tokenId: 'token-1',
    conditionId: 'cid-1',
    bids: [],
    asks: [],
    bestBid: null,
    bestAsk: null,
    bestBidSizeUsd: 0,
    bestAskSizeUsd: 0,
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

describe('runAccumulatorCycle', () => {
  it('places accumulator order when opportunity found and no position', async () => {
    const markets = [makeMarket()];
    const orderbooks = new Map([
      ['cid-1', {
        yes: makeBook({ tokenId: 'yes-1', bestAsk: 0.42, bestAskSizeUsd: 100 }),
        no: makeBook({ tokenId: 'no-1', bestAsk: 0.52, bestAskSizeUsd: 100 }),
      }],
    ]);

    const marketScanner = { fetchMarkets: jest.fn().mockResolvedValue(markets) };
    const orderbookClient = { fetchBook: jest.fn() };
    const orderManager = {
      placeLimitOrder: jest.fn().mockResolvedValue({ orderId: 'o-1', status: 'LIVE' }),
      cancelStaleOrders: jest.fn().mockResolvedValue([]),
      getOpenOrders: jest.fn().mockResolvedValue([]),
    };
    const logger = { write: jest.fn() };

    const result = await runAccumulatorCycle({
      marketScanner,
      orderbookClient,
      orderManager,
      logger,
      accumulatorConfig: ACCUMULATOR_CONFIG,
      equalizerConfig: EQUALIZER_CONFIG,
      riskConfig: RISK_CONFIG,
      currentBalanceUsd: 15,
      getOrderbooks: () => orderbooks,
    });

    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0].side).toBe('YES');
    expect(orderManager.placeLimitOrder).toHaveBeenCalledTimes(1);
    expect(logger.write).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'accumulator_entry',
    }));
  });

  it('skips when risk check fails', async () => {
    const markets = [makeMarket()];
    const orderbooks = new Map([
      ['cid-1', {
        yes: makeBook({ tokenId: 'yes-1', bestAsk: 0.42, bestAskSizeUsd: 100 }),
        no: makeBook({ tokenId: 'no-1', bestAsk: 0.52, bestAskSizeUsd: 100 }),
      }],
    ]);

    const marketScanner = { fetchMarkets: jest.fn().mockResolvedValue(markets) };
    const orderbookClient = { fetchBook: jest.fn() };
    const orderManager = {
      placeLimitOrder: jest.fn(),
      cancelStaleOrders: jest.fn().mockResolvedValue([]),
      getOpenOrders: jest.fn().mockResolvedValue([]),
    };
    const logger = { write: jest.fn() };

    const result = await runAccumulatorCycle({
      marketScanner,
      orderbookClient,
      orderManager,
      logger,
      accumulatorConfig: ACCUMULATOR_CONFIG,
      equalizerConfig: EQUALIZER_CONFIG,
      riskConfig: RISK_CONFIG,
      currentBalanceUsd: 5, // low balance → risk blocks
      getOrderbooks: () => orderbooks,
    });

    expect(orderManager.placeLimitOrder).not.toHaveBeenCalled();
    expect(logger.write).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'risk_blocked',
    }));
  });

  it('logs cycle_error when market fetch fails', async () => {
    const marketScanner = { fetchMarkets: jest.fn().mockRejectedValue(new Error('timeout')) };
    const orderbookClient = { fetchBook: jest.fn() };
    const orderManager = {
      placeLimitOrder: jest.fn(),
      cancelStaleOrders: jest.fn().mockResolvedValue([]),
      getOpenOrders: jest.fn().mockResolvedValue([]),
    };
    const logger = { write: jest.fn() };

    const result = await runAccumulatorCycle({
      marketScanner,
      orderbookClient,
      orderManager,
      logger,
      accumulatorConfig: ACCUMULATOR_CONFIG,
      equalizerConfig: EQUALIZER_CONFIG,
      riskConfig: RISK_CONFIG,
      currentBalanceUsd: 15,
      getOrderbooks: () => new Map(),
    });

    expect(result.decisions).toEqual([]);
    expect(logger.write).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'cycle_error',
    }));
  });
});
