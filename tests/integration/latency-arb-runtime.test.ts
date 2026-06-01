import { assertLatencyArbModeAllowed, runLatencyArbCycle } from '../../src/run-latency-arb';
import { LatencyArbShadowExecutor } from '../../src/simulation/latency-arb-shadow-executor';
import { LatencyArbConfig } from '../../src/strategy/latency-arb-config';
import { MarketState } from '../../src/types/market';
import { BookState } from '../../src/types/book';

const now = 1700000000000;

const config: LatencyArbConfig = {
  symbols: ['btcusdt'],
  binanceWsUrl: 'wss://stream.binance.com:9443',
  lookbackSeconds: 60,
  minPriceChangePct: 0.5,
  minVolumeMultiplier: 1.5,
  emaFastPeriod: 5,
  emaSlowPeriod: 20,
  minDivergencePct: 3,
  minEvPct: 2,
  maxEntryPrice: 0.7,
  minEntryPrice: 0.2,
  minConfidence: 0.6,
  maxPositionSizeUsd: 1.55,
  maxDailyTrades: 20,
  cooldownMs: 0,
  mode: 'shadow',
  marketAsset: 'BTC',
  marketDurationMinutes: 15,
  startingBalanceUsd: 15.48,
  orderBalanceFraction: 0.1,
  maxOrderSizeUsd: 1.55,
  maxSpreadCents: 8,
  maxMarketAgeMs: 2000,
  simulatedLatencyMs: 750,
  logDir: 'logs',
};

function market(): MarketState {
  return {
    conditionId: 'cond-btc-15',
    slug: 'btc-updown-15m-1766162100',
    question: 'BTC Up or Down - 15m',
    yesTokenId: 'yes',
    noTokenId: 'no',
    active: true,
    closed: false,
    enableOrderBook: true,
    feesEnabled: true,
    endDate: new Date(now + 10 * 60_000).toISOString(),
    volume24hUsd: 1000,
    liquidityUsd: 1000,
    oracleAmbiguityScore: 0.05,
  };
}

function book(tokenId: string, bid: number, ask: number): BookState {
  return {
    tokenId,
    conditionId: 'cond-btc-15',
    bids: [],
    asks: [],
    bestBid: bid,
    bestAsk: ask,
    bestBidSizeUsd: 100,
    bestAskSizeUsd: 100,
    midpoint: (bid + ask) / 2,
    spread: ask - bid,
    spreadTicks: Math.round((ask - bid) / 0.01),
    depth1Usd: 200,
    depth3Usd: 500,
    tickSize: 0.01,
    minOrderSize: 1,
    lastUpdateMs: now,
  };
}

describe('latency arb runtime cycle', () => {
  it('should discover BTC 15m market, analyze signal, and write would-order event', async () => {
    const events: Record<string, unknown>[] = [];
    const wouldOrders: unknown[] = [];
    const snapshots: unknown[] = [];
    const momentum = {
      direction: 'BULLISH' as const,
      strength: 1,
      priceChangePct: 2,
      volumeConfirmed: true,
      emaFast: 51000,
      emaSlow: 50000,
      timestamp: now,
    };

    await runLatencyArbCycle({
      nowMs: now,
      config,
      getMomentum: () => momentum,
      fetchMarkets: async () => [market()],
      fetchBook: async (_conditionId, tokenId) => tokenId === 'yes' ? book('yes', 0.44, 0.46) : book('no', 0.54, 0.56),
      writeEvent: (event) => events.push(event),
      currentExposureUsd: () => 0,
      onWouldOrder: (order) => wouldOrders.push(order),
      onExecutionSnapshot: (conditionId, execution, snapshotNowMs) => snapshots.push({ conditionId, execution, snapshotNowMs }),
    });

    expect(events.some((event) => event.eventType === 'signal')).toBe(true);
    expect(events.some((event) => event.eventType === 'would_place_order')).toBe(true);
    expect(wouldOrders).toHaveLength(1);
    expect(wouldOrders[0]).toMatchObject({ orderId: 'shadow-1', conditionId: 'cond-btc-15', action: 'BUY_YES' });
    expect(snapshots).toHaveLength(1);
  });

  it('should keep shadow order ids unique when executor is reused across cycles', async () => {
    const events: Record<string, unknown>[] = [];
    const wouldOrders: unknown[] = [];
    const shadowExecutor = new LatencyArbShadowExecutor({
      mode: 'shadow',
      asset: 'BTC',
      duration: '15m',
      startingBalanceUsd: 15.48,
      orderBalanceFraction: 0.1,
      maxOrderSizeUsd: 1.55,
      maxPositionUsd: 10,
      minConfidence: 0.6,
    }, (event) => events.push(event));
    const momentum = {
      direction: 'BULLISH' as const,
      strength: 1,
      priceChangePct: 2,
      volumeConfirmed: true,
      emaFast: 51000,
      emaSlow: 50000,
      timestamp: now,
    };
    const deps = {
      nowMs: now,
      config: { ...config, maxPositionSizeUsd: 10 },
      getMomentum: () => momentum,
      fetchMarkets: async () => [market()],
      fetchBook: async (_conditionId: string, tokenId: string) => tokenId === 'yes' ? book('yes', 0.44, 0.46) : book('no', 0.54, 0.56),
      writeEvent: (event: Record<string, unknown>) => events.push(event),
      currentExposureUsd: () => 0,
      shadowExecutor,
      onWouldOrder: (order: unknown) => wouldOrders.push(order),
    };

    await runLatencyArbCycle(deps);
    await runLatencyArbCycle({ ...deps, nowMs: now + 1000 });

    expect(wouldOrders).toHaveLength(2);
    expect(wouldOrders.map((order) => (order as { orderId: string }).orderId)).toEqual(['shadow-1', 'shadow-2']);
  });

  it('should write skip when no BTC 15m market is found', async () => {
    const events: Record<string, unknown>[] = [];

    await runLatencyArbCycle({
      nowMs: now,
      config,
      getMomentum: () => null,
      fetchMarkets: async () => [],
      fetchBook: async () => { throw new Error('should not fetch book'); },
      writeEvent: (event) => events.push(event),
      currentExposureUsd: () => 0,
    });

    expect(events[0]).toMatchObject({ eventType: 'skip', reason: 'no_eligible_btc_15m_market' });
  });

  it('should hard-block small_live mode', () => {
    expect(() => assertLatencyArbModeAllowed('small_live')).toThrow('Latency arb live mode is disabled');
    expect(() => assertLatencyArbModeAllowed('shadow')).not.toThrow();
  });
});
