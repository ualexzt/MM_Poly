import { MicroGabagoolConfig, DEFAULT_CONFIG } from './strategy/micro-gabagool-config';
import { computeOpportunityScore } from './engines/micro-gabagool-scorer';
import { passesMarketFilters } from './strategy/micro-gabagool-filters';
import { MicroGabagoolRiskManager } from './risk/micro-gabagool-risk-manager';
import { MicroGabagoolOrderManager } from './execution/micro-gabagool-order-manager';
import { MicroGabagoolPnlTracker } from './accounting/micro-gabagool-pnl-tracker';
import { MicroGabagoolPaperEngine } from './simulation/micro-gabagool-paper-engine';

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
