import {
  runGabagoolCycle,
  assertGabagoolModeAllowed,
  createGabagoolRuntimeFromEnv,
  createJsonlEventWriter,
  CycleDeps,
  MarketCandidate,
} from '../../src/run-micro-gabagool';
import { DEFAULT_CONFIG } from '../../src/strategy/micro-gabagool-config';

const packageJson = require('../../package.json');
import { MicroGabagoolRiskManager } from '../../src/risk/micro-gabagool-risk-manager';
import { MicroGabagoolOrderManager } from '../../src/execution/micro-gabagool-order-manager';
import { MicroGabagoolPnlTracker } from '../../src/accounting/micro-gabagool-pnl-tracker';

const now = 1000000;

function idealMarket(overrides?: Partial<MarketCandidate>): MarketCandidate {
  return {
    conditionId: 'm1',
    tokenId: 'token1',
    bestBid: 0.45,
    bestAsk: 0.48,
    bestBidSizeUsd: 50,
    bestAskSizeUsd: 50,
    timeToSettlementMin: 120,
    hasRecentTrades: true,
    wmpDelta3Min: 0.03,
    spreadChangesLast60Sec: 0,
    ...overrides,
  };
}

function createDeps(overrides?: Partial<CycleDeps>): CycleDeps {
  const riskManager = new MicroGabagoolRiskManager({
    maxDailyLossUsd: 1.50,
    maxTotalExposureUsd: 6.0,
    maxPositionPerMarketUsd: 3.0,
    maxActiveMarkets: 2,
    consecutiveLossLimit: 3,
    marketCooldownAfterLossMinutes: 30,
    marketCooldownAfterTwoBadExitsMinutes: 60,
  }, now);

  const orderManager = new MicroGabagoolOrderManager({
    placeOrder: jest.fn().mockResolvedValue({ orderId: 'exchange-1' }),
    cancelOrder: jest.fn().mockResolvedValue(true),
    getOrderStatus: jest.fn().mockResolvedValue({ status: 'OPEN', filledSizeUsd: 0 }),
    nowMs: () => now,
  });

  const pnlTracker = new MicroGabagoolPnlTracker({
    gasPerRoundtripEstimateUsd: 0.004,
    makerRebateRate: 0.001,
    initialBalanceUsd: 15.0,
  }, now);

  return {
    config: DEFAULT_CONFIG,
    scanner: { scan: async () => [idealMarket()] },
    orderManager,
    riskManager,
    pnlTracker,
    writeEvent: jest.fn(),
    nowMs: () => now,
    ...overrides,
  };
}

describe('micro gabagool integration', () => {
  it('should place entry order for ideal market', async () => {
    const events: Record<string, unknown>[] = [];
    const deps = createDeps({ writeEvent: (event) => events.push(event) });

    await runGabagoolCycle(deps);

    expect(events.some(e => e.eventType === 'entry_placed')).toBe(true);
    expect(deps.orderManager.getOpenOrders()).toHaveLength(1);
  });

  it('should reject market with narrow spread', async () => {
    const events: Record<string, unknown>[] = [];
    const deps = createDeps({
      scanner: { scan: async () => [idealMarket({ bestAsk: 0.46 })] }, // spread = 0.01
      writeEvent: (event) => events.push(event),
    });

    await runGabagoolCycle(deps);

    expect(events.some(e => e.eventType === 'filter_reject' && e.reason === 'spread_too_narrow')).toBe(true);
    expect(deps.orderManager.getOpenOrders()).toHaveLength(0);
  });

  it('should reject market with wide spread', async () => {
    const events: Record<string, unknown>[] = [];
    const deps = createDeps({
      scanner: { scan: async () => [idealMarket({ bestAsk: 0.52 })] }, // spread = 0.07
      writeEvent: (event) => events.push(event),
    });

    await runGabagoolCycle(deps);

    expect(events.some(e => e.eventType === 'filter_reject' && e.reason === 'spread_too_wide')).toBe(true);
  });

  it('should reject market too close to settlement', async () => {
    const events: Record<string, unknown>[] = [];
    const deps = createDeps({
      scanner: { scan: async () => [idealMarket({ timeToSettlementMin: 10 })] },
      writeEvent: (event) => events.push(event),
    });

    await runGabagoolCycle(deps);

    expect(events.some(e => e.eventType === 'filter_reject' && e.reason === 'too_close_to_settlement')).toBe(true);
  });

  it('should reject market with thin liquidity', async () => {
    const events: Record<string, unknown>[] = [];
    const deps = createDeps({
      scanner: { scan: async () => [idealMarket({ bestBidSizeUsd: 5 })] },
      writeEvent: (event) => events.push(event),
    });

    await runGabagoolCycle(deps);

    expect(events.some(e => e.eventType === 'filter_reject' && e.reason === 'bid_depth_too_thin')).toBe(true);
  });

  it('should reject market with no recent trades', async () => {
    const events: Record<string, unknown>[] = [];
    const deps = createDeps({
      scanner: { scan: async () => [idealMarket({ hasRecentTrades: false })] },
      writeEvent: (event) => events.push(event),
    });

    await runGabagoolCycle(deps);

    expect(events.some(e => e.eventType === 'filter_reject' && e.reason === 'no_recent_trades')).toBe(true);
  });

  it('should skip when kill switch active', async () => {
    const events: Record<string, unknown>[] = [];
    const deps = createDeps({ writeEvent: (event) => events.push(event) });

    // Trigger kill switch
    deps.riskManager.enterSafeMode();

    await runGabagoolCycle(deps);

    expect(events.some(e => e.eventType === 'skip' && e.reason === 'kill_switch_safe_mode')).toBe(true);
  });

  it('should hard-block live mode without explicit opt-in', () => {
    expect(() => assertGabagoolModeAllowed('live', false)).toThrow('Live mode requires');
    expect(() => assertGabagoolModeAllowed('live', true)).not.toThrow();
    expect(() => assertGabagoolModeAllowed('paper', false)).not.toThrow();
  });

  it('should expose package script for gabagool runner', () => {
    expect(packageJson.scripts['start:gabagool']).toBe('tsx src/run-micro-gabagool.ts');
  });

  it('should create default gabagool runtime from env safely in paper mode', () => {
    const runtime = createGabagoolRuntimeFromEnv({});

    expect(runtime.config.mode).toBe('paper');
    expect(runtime.config.enableLiveTrading).toBe(false);
    expect(runtime.logPath).toContain('logs/micro-gabagool-');
    expect(runtime.logPath).toMatch(/\.jsonl$/);
    expect(runtime.intervalMs).toBeGreaterThan(0);
    expect(typeof runtime.scanner.scan).toBe('function');
    expect(runtime.orderManager).toBeInstanceOf(MicroGabagoolOrderManager);
    expect(runtime.riskManager).toBeInstanceOf(MicroGabagoolRiskManager);
    expect(runtime.pnlTracker).toBeInstanceOf(MicroGabagoolPnlTracker);
    expect(runtime.paperEngine).toBeDefined();
    expect(typeof runtime.writeEvent).toBe('function');
    expect(typeof runtime.nowMs()).toBe('number');
  });

  it('should reject live runtime unless explicitly enabled', () => {
    expect(() => createGabagoolRuntimeFromEnv({ MODE: 'live' })).toThrow('Live mode requires');
  });

  it('should allow live config with explicit opt-in without requiring a live order submitter', () => {
    const runtime = createGabagoolRuntimeFromEnv({ MODE: 'live', ENABLE_LIVE_TRADING: 'true' });

    expect(runtime.config.mode).toBe('live');
    expect(runtime.config.enableLiveTrading).toBe(true);
    expect(runtime.orderManager).toBeInstanceOf(MicroGabagoolOrderManager);
  });

  it('should parse gabagool live-data env overrides', () => {
    const runtime = createGabagoolRuntimeFromEnv({
      GABAGOOL_SCAN_INTERVAL_MS: '12345',
      GABAGOOL_MAX_MARKETS_PER_SCAN: '17',
      GAMMA_API_BASE_URL: 'https://gamma.test/',
      CLOB_API_BASE_URL: 'https://clob.test/',
    });

    expect(runtime.intervalMs).toBe(12345);
    expect((runtime.scanner as unknown as { gammaBaseUrl: string; maxMarketsPerScan: number }).gammaBaseUrl).toBe('https://gamma.test');
    expect((runtime.scanner as unknown as { maxMarketsPerScan: number }).maxMarketsPerScan).toBe(17);
    const orderbookClient = (runtime.scanner as unknown as { orderbookClient: { baseUrl: string } }).orderbookClient;
    expect(orderbookClient.baseUrl).toBe('https://clob.test');
  });

  it('should write JSONL events with injected append function', () => {
    const appended: Array<{ path: string; line: string }> = [];
    const writer = createJsonlEventWriter('logs/test.jsonl', (path, line) => {
      appended.push({ path, line });
    });

    writer({ eventType: 'startup', timestamp: 123 });

    expect(appended).toEqual([{ path: 'logs/test.jsonl', line: '{"eventType":"startup","timestamp":123}\n' }]);
  });

  it('should not throw when JSONL append fails', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const writer = createJsonlEventWriter('logs/test.jsonl', () => {
      throw new Error('disk full');
    });

    expect(() => writer({ eventType: 'startup' })).not.toThrow();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('should select highest scoring market', async () => {
    const events: Record<string, unknown>[] = [];
    // Use values that avoid floating point issues
    const lowScoreMarket = idealMarket({ conditionId: 'low', bestBid: 0.40, bestAsk: 0.45 }); // spread 0.05, score 5
    const highScoreMarket = idealMarket({ conditionId: 'high', bestBid: 0.50, bestAsk: 0.52 }); // spread 0.02, score 10

    const deps = createDeps({
      scanner: { scan: async () => [lowScoreMarket, highScoreMarket] },
      writeEvent: (event) => {
        events.push(event);
      },
    });

    await runGabagoolCycle(deps);

    const entryEvent = events.find(e => e.eventType === 'entry_placed');
    expect(entryEvent).toBeDefined();
    // The high market should be selected because it has higher score
    expect(entryEvent!.marketId).toBe('high');
  });
});
