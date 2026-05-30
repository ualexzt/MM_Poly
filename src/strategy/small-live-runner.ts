import type { EnvConfig } from '../config/env';
import type { SmallLiveStartupBlocker } from './small-live-preflight';
import type { MarketScanner } from '../data/gamma-market-scanner';
import type { OrderbookClient } from '../data/clob-orderbook-client';
import { PaperExecutionEngine } from '../simulation/paper-execution-engine';
import { LiveOrderSubmitter } from '../execution/live-order-submitter';
import { PaperPnlTracker } from '../accounting/paper-pnl-tracker';
import type { UserStreamEvent } from '../data/ws-user-stream';
import type { Logger } from '../utils/logger';
import type { StrategyConfig } from '../types/config';
import type { MarketState } from '../types/market';
import { defaultConfig } from './config';
import { StrategyRunner } from './strategy-runner';

export function buildSmallLiveConfig(envConfig: EnvConfig): StrategyConfig {
  return {
    ...defaultConfig,
    mode: 'small_live',
    liveTradingEnabled: envConfig.liveTradingEnabled,
    marketFilter: {
      ...defaultConfig.marketFilter,
      minLiquidityUsd: envConfig.minLiquidityUsd,
      minVolume24hUsd: envConfig.minVolume24hUsd,
      maxSpreadCents: envConfig.maxSpreadCents,
    },
    inventory: {
      ...defaultConfig.inventory,
      maxTotalStrategyExposureUsd: Math.min(
        envConfig.maxExposureUsd,
        defaultConfig.inventory.maxTotalStrategyExposureUsd
      ),
    },
    risk: {
      ...defaultConfig.risk,
      maxDailyDrawdownPct: envConfig.maxDrawdownPct * 100,
    },
  };
}

export function buildTokenConditionMap(markets: MarketState[]): Map<string, string> {
  const tokenConditionIds = new Map<string, string>();
  for (const market of markets) {
    if (market.yesTokenId) tokenConditionIds.set(market.yesTokenId, market.conditionId);
    if (market.noTokenId) tokenConditionIds.set(market.noTokenId, market.conditionId);
  }
  return tokenConditionIds;
}

export function createTrackingMarketScanner(
  scanner: MarketScanner,
  tokenConditionIds: Map<string, string>
): MarketScanner {
  return {
    async fetchMarkets(): Promise<MarketState[]> {
      const markets = await scanner.fetchMarkets();
      tokenConditionIds.clear();
      for (const [tokenId, conditionId] of buildTokenConditionMap(markets)) {
        tokenConditionIds.set(tokenId, conditionId);
      }
      return markets;
    },
  };
}

export function handleLiveUserEvent(
  event: UserStreamEvent,
  deps: {
    runner: Pick<StrategyRunner, 'onFill' | 'onOrderUpdate'>;
    pnlTracker: PaperPnlTracker;
    tokenConditionIds: Map<string, string>;
    logger: Logger;
  }
): void {
  if (event.type === 'order') {
    deps.runner.onOrderUpdate(event.data.orderId, event.data.status);
    return;
  }
  if (event.type !== 'fill') return;

  const fill = event.data;
  const conditionId = deps.tokenConditionIds.get(fill.tokenId);
  if (!conditionId) {
    deps.logger.error('Live fill received for unknown token', { tokenId: fill.tokenId, orderId: fill.orderId });
    return;
  }

  deps.runner.onFill(conditionId, fill.tokenId, fill.side, fill.filledPrice, fill.filledSize);
  deps.pnlTracker.onFill({
    orderId: fill.orderId,
    tokenId: fill.tokenId,
    side: fill.side,
    filledPrice: fill.filledPrice,
    filledSize: fill.filledSize,
    remainingSize: 0,
  }, fill.filledPrice);
}

export interface LiveCancelAllResult {
  total: number;
  failed: number;
  failedOrderIds: string[];
}

export async function cancelAllLiveOrders(liveSubmitter: LiveOrderSubmitter, logger: Logger): Promise<LiveCancelAllResult> {
  const openOrders = await liveSubmitter.getOpenOrders();
  const orderIds = openOrders
    .map((order) => order.id ?? order.orderID ?? order.orderId)
    .filter((orderId): orderId is string => typeof orderId === 'string' && orderId.length > 0);

  const results = await Promise.allSettled(orderIds.map((orderId) => liveSubmitter.cancel(orderId)));
  const failedOrderIds = results
    .map((result, index) => result.status === 'rejected' ? orderIds[index] : null)
    .filter((orderId): orderId is string => orderId !== null);

  if (failedOrderIds.length > 0) {
    logger.error('Failed to cancel some live orders', {
      failed: failedOrderIds.length,
      total: orderIds.length,
      failedOrderIds,
    });
  }

  return { total: orderIds.length, failed: failedOrderIds.length, failedOrderIds };
}

export interface EnsureNoOpenLiveOrdersResult {
  ok: boolean;
  cancelResult?: LiveCancelAllResult;
}

export async function ensureNoOpenLiveOrders(
  liveSubmitter: LiveOrderSubmitter,
  envConfig: EnvConfig,
  logger: Logger,
  notifyStartupBlockers: (
    blockers: SmallLiveStartupBlocker[],
    envConfig: EnvConfig,
    logger: Logger
  ) => Promise<void>
): Promise<EnsureNoOpenLiveOrdersResult> {
  try {
    const cancelResult = await cancelAllLiveOrders(liveSubmitter, logger);
    if (cancelResult.failed > 0) {
      await notifyStartupBlockers(['startup_cancel_failed'], envConfig, logger);
      return { ok: false, cancelResult };
    }
    return { ok: true, cancelResult };
  } catch (err) {
    logger.error('Failed to list/cancel live orders during startup', { error: String(err) });
    await notifyStartupBlockers(['startup_cancel_failed'], envConfig, logger);
    return { ok: false };
  }
}

export function createSmallLiveStrategyRunner(deps: {
  envConfig: EnvConfig;
  scanner: MarketScanner;
  bookClient: OrderbookClient;
  paperEngine?: PaperExecutionEngine;
  liveSubmitter: LiveOrderSubmitter;
  logger: Logger;
}): StrategyRunner {
  return new StrategyRunner({
    config: buildSmallLiveConfig(deps.envConfig),
    scanner: deps.scanner,
    bookClient: deps.bookClient,
    paperEngine: deps.paperEngine ?? new PaperExecutionEngine(defaultConfig.paperExecution),
    liveSubmitter: deps.liveSubmitter,
    logger: deps.logger,
    maxMarkets: deps.envConfig.maxMarkets,
  });
}
