import 'dotenv/config';
import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { MicroGabagoolConfig, DEFAULT_CONFIG } from './strategy/micro-gabagool-config';
import { computeOpportunityScore } from './engines/micro-gabagool-scorer';
import { passesMarketFilters } from './strategy/micro-gabagool-filters';
import { MicroGabagoolRiskManager } from './risk/micro-gabagool-risk-manager';
import { MicroGabagoolOrderManager } from './execution/micro-gabagool-order-manager';
import { MicroGabagoolPnlTracker } from './accounting/micro-gabagool-pnl-tracker';
import { MicroGabagoolPaperEngine } from './simulation/micro-gabagool-paper-engine';
import { MicroGabagoolClobOrderbookClient } from './data/micro-gabagool-clob-orderbook-client';
import { GammaMicroGabagoolScanner } from './strategy/gamma-micro-gabagool-scanner';
import { TelegramNotifier } from './notifier/telegram';

export interface MarketCandidate {
  conditionId: string;
  tokenId: string;
  bestBid: number;
  bestAsk: number;
  bestBidSizeUsd: number;
  bestAskSizeUsd: number;
  timeToSettlementMin: number;
  hasRecentTrades: boolean;
  wmpDelta3Min: number;
  spreadChangesLast60Sec: number;
}

export interface CycleDeps {
  config: MicroGabagoolConfig;
  scanner: { scan: () => Promise<MarketCandidate[]> };
  orderManager: MicroGabagoolOrderManager;
  riskManager: MicroGabagoolRiskManager;
  pnlTracker: MicroGabagoolPnlTracker;
  paperEngine?: MicroGabagoolPaperEngine;
  writeEvent: (event: Record<string, unknown>) => void;
  nowMs: () => number;
}

export interface GabagoolRuntime extends Required<CycleDeps> {
  logPath: string;
  intervalMs: number;
}

export type JsonlAppendFn = (path: string, line: string) => void;

const DEFAULT_SCAN_INTERVAL_MS = 30_000;
const DEFAULT_MAX_MARKETS_PER_SCAN = 100;
const DEFAULT_GAMMA_API_BASE_URL = 'https://gamma-api.polymarket.com';
const DEFAULT_CLOB_API_BASE_URL = 'https://clob.polymarket.com';
const SAFE_PAPER_FILL_PROBABILITY = 0;
const SAFE_PAPER_PARTIAL_FILL_PROBABILITY = 0;
const SAFE_PAPER_LATE_FILL_PROBABILITY = 0;

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const floored = Math.floor(parsed);
  return floored >= 1 ? floored : fallback;
}

function defaultJsonlAppend(path: string, line: string): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, line, { encoding: 'utf8' });
}

export function createJsonlEventWriter(
  logPath: string,
  append: JsonlAppendFn = defaultJsonlAppend,
): (event: Record<string, unknown>) => void {
  return (event: Record<string, unknown>) => {
    try {
      append(logPath, `${JSON.stringify(event)}\n`);
    } catch (error) {
      console.error('micro_gabagool JSONL append failed:', error);
    }
  };
}

export function createGabagoolRuntimeFromEnv(env: NodeJS.ProcessEnv = process.env): GabagoolRuntime {
  const mode: MicroGabagoolConfig['mode'] = env.MODE === 'live' ? 'live' : 'paper';
  const enableLiveTrading = env.ENABLE_LIVE_TRADING === 'true';
  assertGabagoolModeAllowed(mode, enableLiveTrading);

  const config: MicroGabagoolConfig = {
    ...DEFAULT_CONFIG,
    mode,
    enableLiveTrading,
  };
  const nowMs = () => Date.now();
  const intervalMs = parsePositiveInteger(env.GABAGOOL_SCAN_INTERVAL_MS, DEFAULT_SCAN_INTERVAL_MS);
  const maxMarketsPerScan = parsePositiveInteger(env.GABAGOOL_MAX_MARKETS_PER_SCAN, DEFAULT_MAX_MARKETS_PER_SCAN);
  const gammaBaseUrl = env.GAMMA_API_BASE_URL ?? DEFAULT_GAMMA_API_BASE_URL;
  const clobBaseUrl = env.CLOB_API_BASE_URL ?? DEFAULT_CLOB_API_BASE_URL;
  const logPath = env.GABAGOOL_LOG_PATH
    ?? `logs/micro-gabagool-${new Date(nowMs()).toISOString().slice(0, 10)}.jsonl`;

  const orderbookClient = new MicroGabagoolClobOrderbookClient({ baseUrl: clobBaseUrl });
  const scanner = new GammaMicroGabagoolScanner({
    gammaBaseUrl,
    maxMarketsPerScan,
    nowMs,
  }, orderbookClient);
  let simulatedOrderSeq = 0;
  const orderManager = new MicroGabagoolOrderManager({
    placeOrder: async () => {
      if (config.mode === 'live') {
        throw new Error('Live order placement is not implemented for micro_gabagool MVP');
      }
      simulatedOrderSeq += 1;
      return { orderId: `paper-gabagool-${simulatedOrderSeq}` };
    },
    cancelOrder: async () => true,
    getOrderStatus: async () => ({ status: 'OPEN', filledSizeUsd: 0 }),
    nowMs,
  });
  const riskManager = new MicroGabagoolRiskManager({
    maxDailyLossUsd: config.maxDailyLossUsd,
    maxTotalExposureUsd: config.maxTotalExposureUsd,
    maxPositionPerMarketUsd: config.maxPositionPerMarketUsd,
    maxActiveMarkets: config.maxActiveMarkets,
    consecutiveLossLimit: config.consecutiveLossLimit,
    marketCooldownAfterLossMinutes: config.marketCooldownAfterLossMinutes,
    marketCooldownAfterTwoBadExitsMinutes: config.marketCooldownAfterTwoBadExitsMinutes,
  }, nowMs());
  const pnlTracker = new MicroGabagoolPnlTracker({
    gasPerRoundtripEstimateUsd: config.gasPerRoundtripEstimateUsd,
    makerRebateRate: config.makerRebateRate,
    initialBalanceUsd: config.initialBalanceUsd,
  }, nowMs());
  const paperEngine = new MicroGabagoolPaperEngine({
    gasPerRoundtripEstimateUsd: config.gasPerRoundtripEstimateUsd,
    makerRebateRate: config.makerRebateRate,
    fillProbability: SAFE_PAPER_FILL_PROBABILITY,
    partialFillProbability: SAFE_PAPER_PARTIAL_FILL_PROBABILITY,
    lateFillProbability: SAFE_PAPER_LATE_FILL_PROBABILITY,
  }, nowMs);

  return {
    config,
    logPath,
    intervalMs,
    scanner,
    orderManager,
    riskManager,
    pnlTracker,
    paperEngine,
    writeEvent: createJsonlEventWriter(logPath),
    nowMs,
  };
}

export async function runGabagoolCycle(deps: CycleDeps): Promise<void> {
  const { config, scanner, orderManager, riskManager, pnlTracker, paperEngine, writeEvent, nowMs } = deps;

  // Reset daily PnL if new day
  riskManager.resetDaily(nowMs());

  // Check kill switch
  const killState = riskManager.getKillSwitchState();
  if (killState !== 'ACTIVE') {
    writeEvent({ eventType: 'skip', reason: `kill_switch_${killState.toLowerCase()}`, timestamp: nowMs() });
    return;
  }

  // Check for pending order timeouts
  const timedOut = await orderManager.checkOrderTimeouts(config.maxOrderAgeSeconds);
  for (const order of timedOut) {
    await orderManager.cancelOrder(order.id);
    writeEvent({
      eventType: 'order_timeout',
      orderId: order.id,
      marketId: order.marketId,
      timestamp: nowMs(),
    });
  }

  // Scan markets
  const markets = await scanner.scan();

  // Filter and score markets
  const candidates: Array<{ market: MarketCandidate; score: number }> = [];

  for (const market of markets) {
    // Apply filters
    const filterResult = passesMarketFilters({
      bestBid: market.bestBid,
      bestAsk: market.bestAsk,
      bestBidSizeUsd: market.bestBidSizeUsd,
      bestAskSizeUsd: market.bestAskSizeUsd,
      timeToSettlementMin: market.timeToSettlementMin,
      hasRecentTrades: market.hasRecentTrades,
      isInCooldown: false, // TODO: integrate with risk manager cooldowns
      hasActivePosition: pnlTracker.hasPosition(market.conditionId),
      hasActiveOrder: orderManager.hasOpenOrderForMarket(market.conditionId),
      minSpread: config.minSpread,
      maxSpread: config.maxSpread,
      minBid: config.minBid,
      maxAsk: config.maxAsk,
      minTimeToSettlementMinutes: config.minTimeToSettlementMinutes,
      minTopOfBookSizeUsd: config.minTopOfBookSizeUsd,
    });

    if (!filterResult.pass) {
      writeEvent({
        eventType: 'filter_reject',
        marketId: market.conditionId,
        reason: filterResult.reason,
        timestamp: nowMs(),
      });
      continue;
    }

    // Score market
    const scoreResult = computeOpportunityScore({
      spread: market.bestAsk - market.bestBid,
      bestBidSizeUsd: market.bestBidSizeUsd,
      bestAskSizeUsd: market.bestAskSizeUsd,
      wmpDelta3Min: market.wmpDelta3Min,
      spreadChangesLast60Sec: market.spreadChangesLast60Sec,
      timeToSettlementMin: market.timeToSettlementMin,
    }, config.minScoreToTrade);

    if (!scoreResult.passThreshold) {
      writeEvent({
        eventType: 'score_reject',
        marketId: market.conditionId,
        score: scoreResult.totalScore,
        timestamp: nowMs(),
      });
      continue;
    }

    candidates.push({ market, score: scoreResult.totalScore });
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  // Try to enter top candidate
  for (const { market, score } of candidates) {
    const entryPrice = market.bestBid + config.tickSize;
    const expectedProfit = config.tickSize; // 1 tick spread capture
    const expectedNetProfit = expectedProfit - config.gasPerRoundtripEstimateUsd + (config.orderSizeMinUsd * config.makerRebateRate);

    // Check min profit threshold
    if (expectedNetProfit < config.minProfitThresholdUsd) {
      writeEvent({
        eventType: 'skip',
        reason: 'below_min_profit_threshold',
        marketId: market.conditionId,
        expectedNetProfit,
        timestamp: nowMs(),
      });
      continue;
    }

    // Risk check
    const riskCheck = riskManager.canEnterMarket(market.conditionId, config.orderSizeMinUsd, nowMs());
    if (!riskCheck.allowed) {
      writeEvent({
        eventType: 'risk_block',
        marketId: market.conditionId,
        reason: riskCheck.reason,
        timestamp: nowMs(),
      });
      continue;
    }

    // Place entry order
    try {
      const order = await orderManager.placeEntry({
        marketId: market.conditionId,
        tokenId: market.tokenId,
        side: 'BUY',
        price: entryPrice,
        sizeUsd: config.orderSizeMinUsd,
        isPostOnly: true,
      });

      riskManager.addExposure(market.conditionId, config.orderSizeMinUsd);

      writeEvent({
        eventType: 'entry_placed',
        orderId: order.id,
        marketId: market.conditionId,
        price: entryPrice,
        sizeUsd: config.orderSizeMinUsd,
        score,
        timestamp: nowMs(),
      });

      break; // Only one entry per cycle
    } catch (error) {
      writeEvent({
        eventType: 'entry_error',
        marketId: market.conditionId,
        error: String(error),
        timestamp: nowMs(),
      });
    }
  }
}

export function assertGabagoolModeAllowed(mode: MicroGabagoolConfig['mode'], enableLiveTrading: boolean): void {
  if (mode === 'live' && !enableLiveTrading) {
    throw new Error('Live mode requires enable_live_trading: true');
  }
}

export type GabagoolLoopScheduler = (callback: () => void, delayMs: number) => unknown;

export function startGabagoolCycleLoop(
  runCycleSafely: () => Promise<void>,
  intervalMs: number,
  schedule: GabagoolLoopScheduler = (callback, delayMs) => setTimeout(callback, delayMs),
): void {
  const runThenSchedule = async (): Promise<void> => {
    try {
      await runCycleSafely();
    } catch {
      // Keep the runner alive even if a caller provides a non-guarded cycle function.
    } finally {
      schedule(() => {
        void runThenSchedule();
      }, intervalMs);
    }
  };

  void runThenSchedule();
}

export async function main(): Promise<void> {
  const runtime = createGabagoolRuntimeFromEnv();
  runtime.writeEvent({
    eventType: 'startup',
    mode: runtime.config.mode,
    enableLiveTrading: runtime.config.enableLiveTrading,
    intervalMs: runtime.intervalMs,
    timestamp: runtime.nowMs(),
  });

  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    const telegram = new TelegramNotifier({
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      chatId: process.env.TELEGRAM_CHAT_ID,
    });
    await telegram.sendMessage(
      `micro_gabagool runner started in ${runtime.config.mode} mode (live enabled: ${runtime.config.enableLiveTrading})`,
    );
  }

  const runCycleSafely = async () => {
    try {
      await runGabagoolCycle(runtime);
    } catch (error) {
      runtime.writeEvent({
        eventType: 'cycle_error',
        error: String(error),
        timestamp: runtime.nowMs(),
      });
      console.error('micro_gabagool cycle failed:', error);
    }
  };

  startGabagoolCycleLoop(runCycleSafely, runtime.intervalMs);
}

if (require.main === module) {
  void main();
}
