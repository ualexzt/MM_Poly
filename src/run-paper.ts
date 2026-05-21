import 'dotenv/config';
import { env } from './config/env';
import { WsMarketStream } from './data/ws-market-stream';
import { GammaApiScanner } from './data/gamma-market-scanner';
import { ClobApiClient } from './data/clob-orderbook-client';
import { PaperExecutionEngine } from './simulation/paper-execution-engine';
import { PaperPnlTracker } from './accounting/paper-pnl-tracker';
import { TradingActivityTracker } from './accounting/trading-activity-tracker';
import { defaultConfig } from './strategy/config';
import { ConsoleLogger } from './utils/logger';
import { TelegramNotifier } from './notifier/telegram';
import { computeFairPrice } from './engines/fair-price-engine';
import { filterEligibleMarkets } from './strategy/market-selector';
import { generateQuoteCandidate } from './engines/quote-engine';
import { createTrace } from './accounting/decision-trace';
import { isBookStale } from './risk/stale-book-guard';
import { MarketRiskDecision, maxRiskStatus, RiskStatus, StrategyRiskManager } from './risk/strategy-risk-manager';
import { formatTelegramRiskReport, RiskTrajectorySnapshot } from './reporting/telegram-risk-report';
import { BookState } from './types/book';
import { MarketState } from './types/market';

const QUOTE_COOLDOWN_MS = 10000;   // 10 sec between quote recalculation per market
const ORDER_TTL_MS = 60000;        // 60 sec max lifetime for an order before replace
const PRICE_EPSILON = 0.005;       // half tick — treat as same price
// Kyiv time reports: 08:00 and 20:00 Kyiv = 05:00 and 17:00 UTC
const REPORT_HOURS_UTC = [5, 17];

interface ActiveOrder {
  orderId: string;
  price: number;
  size: number;
  submittedAt: number;
}

interface MarketActiveOrders {
  buy: ActiveOrder | null;
  sell: ActiveOrder | null;
}

async function main() {
  const logger = new ConsoleLogger();
  const telegram = new TelegramNotifier({ botToken: env.telegramBotToken, chatId: env.telegramChatId });
  const scanner = new GammaApiScanner();
  const bookClient = new ClobApiClient();
  const paperEngine = new PaperExecutionEngine();
  const pnlTracker = new PaperPnlTracker();
  const startedAt = new Date();
  let warningsCount = 0;
  let errorsCount = 0;
  const activityTracker = new TradingActivityTracker();
  const latestRiskDecisions = new Map<string, MarketRiskDecision>();

  // Apply env overrides
  const config = {
    ...defaultConfig,
    marketFilter: {
      ...defaultConfig.marketFilter,
      minLiquidityUsd: env.minLiquidityUsd,
      minVolume24hUsd: env.minVolume24hUsd,
      maxSpreadCents: env.maxSpreadCents,
    },
    inventory: {
      ...defaultConfig.inventory,
      maxTotalStrategyExposureUsd: env.maxExposureUsd,
    },
    risk: {
      ...defaultConfig.risk,
      maxDailyDrawdownPct: env.maxDrawdownPct * 100, // convert to pct
    }
  };

  const riskManager = new StrategyRiskManager({
    softInventoryLimitPct: config.inventory.softLimitPct,
    reduceOnlyLimitPct: config.inventory.reduceOnlyLimitPct,
    hardInventoryLimitPct: config.inventory.hardLimitPct,
    maxMarketExposureUsd: config.inventory.maxMarketExposureUsd,
    concentrationWarningPct: 90,
    concentrationCriticalPctLive: 90,
  });

  logger.info('=== Polymarket MM Strategy — Paper Trading ===');
  logger.info(`Mode: ${env.mode}`);
  logger.info('Data source: WebSocket live stream');

  await telegram.sendMessage(
    `🚀 <b>Bot started</b>\nMode: <b>PAPER TRADING</b>\nReports: 08:00 & 20:00 Kyiv time`
  );

  let markets: MarketState[] = [];
  let eligible: MarketState[] = [];
  const books = new Map<string, BookState>();
  const lastQuoteTime = new Map<string, number>(); // per conditionId
  const activeOrders = new Map<string, MarketActiveOrders>();

  function getActiveOrders(conditionId: string): MarketActiveOrders {
    let orders = activeOrders.get(conditionId);
    if (!orders) {
      orders = { buy: null, sell: null };
      activeOrders.set(conditionId, orders);
    }
    return orders;
  }

  function cancelSideOrder(orders: MarketActiveOrders, side: 'BUY' | 'SELL'): void {
    const key = side === 'BUY' ? 'buy' : 'sell';
    const activeOrder = orders[key];
    if (!activeOrder) return;
    paperEngine.cancel(activeOrder.orderId);
    orders[key] = null;
  }

  function cancelMarketOrders(conditionId: string): void {
    const orders = getActiveOrders(conditionId);
    cancelSideOrder(orders, 'BUY');
    cancelSideOrder(orders, 'SELL');
  }

  try {
    markets = await scanner.fetchMarkets();
    eligible = filterEligibleMarkets(markets, config.marketFilter);
    logger.info(`Loaded ${markets.length} markets, ${eligible.length} eligible`);
  } catch (err) {
    errorsCount += 1;
    logger.error('Failed to load markets', { error: String(err) });
    process.exit(1);
  }

  const activeMarkets = eligible.slice(0, env.maxMarkets);
  const tokenIds = activeMarkets.flatMap(m => [m.yesTokenId, m.noTokenId]).filter(Boolean) as string[];

  // Pre-fetch initial books
  for (const market of activeMarkets) {
    try {
      if (market.yesTokenId) {
        const book = await bookClient.fetchBook(market.conditionId, market.yesTokenId);
        books.set(market.yesTokenId, book);
      }
      if (market.noTokenId) {
        const book = await bookClient.fetchBook(market.conditionId, market.noTokenId);
        books.set(market.noTokenId, book);
      }
    } catch (err) {
      warningsCount += 1;
      logger.warn('Initial book fetch failed', { conditionId: market.conditionId, error: String(err) });
    }
  }

  function getInventorySkew(tokenId: string): number {
    const pos = pnlTracker.getPosition(tokenId);
    if (!pos || pos.netSize === 0) return 0;
    const maxPos = env.maxExposureUsd / 100;
    const skew = Math.tanh(pos.netSize / maxPos) * config.inventory.maxSkewCents;
    return skew;
  }

  function shouldReplace(current: ActiveOrder | null, newPrice: number, newSize: number, now: number): boolean {
    if (!current) return true;
    if (now - current.submittedAt > ORDER_TTL_MS) return true;
    if (Math.abs(current.price - newPrice) > PRICE_EPSILON) return true;
    if (Math.abs(current.size - newSize) > 0.01) return true;
    return false;
  }

  function evaluateMarket(market: MarketState, tradePrice?: number) {
    const yesBook = books.get(market.yesTokenId);
    const noBook = books.get(market.noTokenId);
    if (!yesBook || !noBook) return;

    const ao = getActiveOrders(market.conditionId);
    const bookStale = isBookStale(yesBook.lastUpdateMs, config.staleOrderMaxAgeMs);
    const hasActiveQuotesBeforeFair = Boolean(ao.buy || ao.sell);

    if (bookStale) {
      const staleRiskDecision = riskManager.evaluateMarket({
        mode: env.mode,
        conditionId: market.conditionId,
        tokenId: market.yesTokenId,
        position: pnlTracker.getPosition(market.yesTokenId),
        book: yesBook,
        currentFair: null,
        primaryMarketQuoteSharePct: activityTracker.snapshot().primaryMarketQuoteSharePct,
        hasActiveQuotes: hasActiveQuotesBeforeFair,
        isBookStale: true,
        killSwitchActive: false,
      });
      latestRiskDecisions.set(market.conditionId, staleRiskDecision);
      if (hasActiveQuotesBeforeFair) {
        cancelMarketOrders(market.conditionId);
      }
      return;
    }

    const yesFair = computeFairPrice({
      bestBid: yesBook.bestBid || 0, bestAsk: yesBook.bestAsk || 0,
      bestBidSize: yesBook.bestBidSizeUsd, bestAskSize: yesBook.bestAskSizeUsd,
      lastTradeEma: yesBook.lastTradePrice || null,
      complementMidpoint: noBook.midpoint,
      weights: config.fairPrice.weights
    });
    if (!yesFair) return;

    // Always simulate fills if a trade price came through WS
    // We do NOT cancel orders before fill check — they sit in the book like real orders
    if (tradePrice !== undefined) {
      const fills = paperEngine.onTrade({ tokenId: market.yesTokenId, price: tradePrice, size: 3 });
      const openOrders = paperEngine.getOpenOrders();
      for (const fill of fills) {
        const order = openOrders.find(o => o.id === fill.orderId);
        // Skip unrealistic fills (price too far from our quote — means we weren't at the top of book)
        if (order && Math.abs(fill.filledPrice - order.price) > 0.02) {
          continue;
        }
        pnlTracker.onFill(fill, yesFair.fairPrice);
        activityTracker.recordFill(market.conditionId, fill);
        logger.info('Paper fill', {
          side: fill.side,
          price: fill.filledPrice,
          size: fill.filledSize,
          remaining: fill.remainingSize,
          pnl: pnlTracker.getPosition(fill.tokenId)?.realizedPnl?.toFixed(2)
        });
      }
    }

    const activitySnapshot = activityTracker.snapshot();
    const pos = pnlTracker.getPosition(market.yesTokenId);
    const hasActiveQuotes = Boolean(ao.buy || ao.sell);
    const riskDecision = riskManager.evaluateMarket({
      mode: env.mode,
      conditionId: market.conditionId,
      tokenId: market.yesTokenId,
      position: pos,
      book: yesBook,
      currentFair: yesFair.fairPrice,
      primaryMarketQuoteSharePct: activitySnapshot.primaryMarketQuoteSharePct,
      hasActiveQuotes,
      isBookStale: false,
      killSwitchActive: false,
    });
    latestRiskDecisions.set(market.conditionId, riskDecision);

    // Quote cooldown: skip recalculation if < 10s since last quote for this market
    const now = Date.now();
    const lastQuote = lastQuoteTime.get(market.conditionId) || 0;
    if (now - lastQuote < QUOTE_COOLDOWN_MS) return;
    lastQuoteTime.set(market.conditionId, now);

    const toxicityScore = 0.1;
    const inventorySkew = getInventorySkew(market.yesTokenId);

    for (const side of ['BUY', 'SELL'] as const) {
      const aoKey = side === 'BUY' ? 'buy' : 'sell';
      if ((side === 'BUY' && !riskDecision.allowBuy) || (side === 'SELL' && !riskDecision.allowSell)) {
        activityTracker.recordQuoteRejected(market.conditionId);
        cancelSideOrder(ao, side);
        continue;
      }
      const maxPos = env.maxExposureUsd / 100;
      const inventoryPct = Math.min(100, (Math.abs(pos?.netSize || 0) / maxPos) * 100);

      const quoteResult = generateQuoteCandidate({
        conditionId: market.conditionId,
        tokenId: market.yesTokenId,
        side,
        fairPrice: yesFair.fairPrice,
        book: yesBook,
        spread: config.spread,
        size: config.size,
        toxicityScore,
        inventoryPct,
        inventorySkewCents: inventorySkew,
        isBookStale: false
      });

      const quotes = quoteResult ? [quoteResult.candidate] : [];

      for (const quote of quotes) {
        const current = ao[aoKey];

        // Only replace if price/size changed meaningfully or order is too old
        if (!shouldReplace(current, quote.price, quote.size, now)) {
          continue;
        }

        // Cancel old order if exists
        if (current) {
          paperEngine.cancel(current.orderId);
        }

        const orderId = `${market.conditionId}-${side}-${now}`;
        paperEngine.submit({
          id: orderId,
          tokenId: market.yesTokenId,
          side,
          price: quote.price,
          size: quote.size,
          sizeUsd: quote.sizeUsd,
          postOnly: true
        });

        ao[aoKey] = { orderId, price: quote.price, size: quote.size, submittedAt: now };

        const trace = createTrace({
          mode: 'paper',
          conditionId: market.conditionId,
          tokenId: market.yesTokenId,
          side,
          bestBid: yesBook.bestBid,
          bestAsk: yesBook.bestAsk,
          spreadTicks: yesBook.spreadTicks,
          fairPrice: yesFair.fairPrice,
          microprice: yesFair.microprice,
          complementFair: noBook.midpoint,
          lastTradeEma: yesBook.lastTradePrice || null,
          toxicityScore,
          inventoryPct,
          inventorySkewCents: inventorySkew,
          targetPrice: quote.price,
          targetSizeUsd: quote.sizeUsd,
          decision: 'quote',
          reason: quote.reason,
          riskFlags: quote.riskFlags
        });

        logger.trace(trace);
        activityTracker.recordQuoteGenerated(market.conditionId);
      }
    }
  }

  // Initial evaluation
  for (const market of activeMarkets) {
    evaluateMarket(market);
  }

  // WebSocket
  const ws = new WsMarketStream(
    'wss://ws-subscriptions-clob.polymarket.com/ws/market',
    (update) => {
      if (update.book) {
        books.set(update.tokenId, update.book);
        const market = activeMarkets.find(m => m.yesTokenId === update.tokenId || m.noTokenId === update.tokenId);
        if (market) {
          // Only simulate fills if the trade occurred on the YES token
          const tradePrice = update.tokenId === market.yesTokenId ? (update.lastTradePrice ?? undefined) : undefined;
          evaluateMarket(market, tradePrice);
        }
      }
    },
    (err) => {
      errorsCount += 1;
      logger.error('WS error', { error: err.message });
    }
  );

  ws.connect(tokenIds);

  // Report diagnostics — stateful tracking across report intervals
  let nonOkStatusStartedAtMs: number | null = null;
  let previousRiskSnapshot: {
    status: RiskStatus;
    usagePct: number | null;
    reduceOnly: boolean;
    reasons: string[];
  } | null = null;

  function getTopInventoryDecisions(decisions: MarketRiskDecision[]): MarketRiskDecision[] {
    return [...decisions]
      .filter(decision => decision.positionSide !== 'FLAT' && decision.netPosition !== 0)
      .sort((a, b) => {
        const usageA = a.inventoryUsagePct ?? -1;
        const usageB = b.inventoryUsagePct ?? -1;
        if (usageA !== usageB) return usageB - usageA;
        return Math.abs(b.netPosition) - Math.abs(a.netPosition);
      })
      .slice(0, 5);
  }

  function buildRiskTrajectory(snapshot: {
    status: RiskStatus;
    usagePct: number | null;
    reduceOnly: boolean;
    reasons: string[];
  }): RiskTrajectorySnapshot {
    if (previousRiskSnapshot === null) {
      return {
        previousStatus: null,
        currentStatus: snapshot.status,
        previousUsagePct: null,
        currentUsagePct: snapshot.usagePct,
        usageDirection: null,
        previousReduceOnly: null,
        currentReduceOnly: snapshot.reduceOnly,
        previousReasons: null,
        currentReasons: snapshot.reasons,
      };
    }

    let usageDirection: RiskTrajectorySnapshot['usageDirection'] = null;
    if (previousRiskSnapshot.usagePct !== null && snapshot.usagePct !== null) {
      if (snapshot.usagePct < previousRiskSnapshot.usagePct) usageDirection = 'improving';
      else if (snapshot.usagePct > previousRiskSnapshot.usagePct) usageDirection = 'worsening';
      else usageDirection = 'flat';
    }

    return {
      previousStatus: previousRiskSnapshot.status,
      currentStatus: snapshot.status,
      previousUsagePct: previousRiskSnapshot.usagePct,
      currentUsagePct: snapshot.usagePct,
      usageDirection,
      previousReduceOnly: previousRiskSnapshot.reduceOnly,
      currentReduceOnly: snapshot.reduceOnly,
      previousReasons: previousRiskSnapshot.reasons,
      currentReasons: snapshot.reasons,
    };
  }

  // Report scheduler — 08:00 and 20:00 Kyiv (05:00 & 17:00 UTC)
  function scheduleReport(hourUtc: number) {
    const now = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc, 0));
    if (next.getTime() <= now.getTime()) {
      next.setUTCDate(next.getUTCDate() + 1);
    }
    const delay = next.getTime() - now.getTime();
    logger.info(`Next report scheduled at ${next.toISOString()}`);

    setTimeout(async () => {
      const fairPrices = new Map<string, number>();
      for (const [tokenId, book] of books) {
        if (book.midpoint !== null) fairPrices.set(tokenId, book.midpoint);
      }
      const dateStr = new Date().toISOString().slice(0, 10);
      // Daily snapshot uses current accumulated realized vs start-of-day
      const report = pnlTracker.endDay(dateStr, fairPrices);
      // Start new day tracking
      pnlTracker.startNewDay(dateStr);

      const activity = activityTracker.snapshot();
      const cumulativeRealized = pnlTracker.getCumulativeRealizedPnl();
      const unrealizedFairBased = report.unrealizedPnl;
      const estimatedTotalPnl = cumulativeRealized + unrealizedFairBased + report.estimatedRebate;
      
      // Filter out risk decisions for markets that are not active or don't have current quotes
      // This prevents stale markets from artificially inflating the risk status and reasons in the report.
      const nowMs = Date.now();
      const recentDecisions = Array.from(latestRiskDecisions.values()).filter(d => {
          const lastQuoteTimeMs = lastQuoteTime.get(d.conditionId) || 0;
          const quotedRecently = (nowMs - lastQuoteTimeMs) < 60_000;
          const hasPosition = (pnlTracker.getPosition(d.tokenId)?.netSize ?? 0) !== 0;
          return quotedRecently || hasPosition;
      });
      const allDecisionsToReport = recentDecisions;

      const globalRiskStatus = maxRiskStatus(allDecisionsToReport.map(d => d.riskStatus));
      const topDecision = activity.primaryMarketConditionId
        ? latestRiskDecisions.get(activity.primaryMarketConditionId) ?? null
        : allDecisionsToReport[0] ?? null;
      const openPositionsCount = Array.from(latestRiskDecisions.values()).filter(d => (pnlTracker.getPosition(d.tokenId)?.netSize ?? 0) !== 0).length;
      const realizedAbs = Math.abs(cumulativeRealized);
      const unrealizedToRealizedRatio = realizedAbs > 0 ? Math.abs(unrealizedFairBased) / realizedAbs : null;
      const marketTitleByConditionId = new Map(markets.map(m => [m.conditionId, m.question ?? m.conditionId]));

      // Update non-OK status duration tracking
      if (globalRiskStatus === 'OK') {
        nonOkStatusStartedAtMs = null;
      } else if (nonOkStatusStartedAtMs === null) {
        nonOkStatusStartedAtMs = nowMs;
      }

      // Build report diagnostics
      const timeInNonOkStatusMs = nonOkStatusStartedAtMs === null ? null : nowMs - nonOkStatusStartedAtMs;
      const topInventoryDecisions = getTopInventoryDecisions(allDecisionsToReport);
      const currentTopInventoryUsagePct = topInventoryDecisions[0]?.inventoryUsagePct ?? null;
      const aggregatedReasons = Array.from(new Set(allDecisionsToReport.flatMap(d => d.reasons)));
      const aggregatedReduceOnly = allDecisionsToReport.some(d => d.reduceOnly);
      const currentRiskSnapshot = {
        status: globalRiskStatus,
        usagePct: currentTopInventoryUsagePct,
        reduceOnly: aggregatedReduceOnly,
        reasons: [...aggregatedReasons].sort(),
      };
      const riskTrajectory = buildRiskTrajectory(currentRiskSnapshot);
      previousRiskSnapshot = currentRiskSnapshot;

      const text = formatTelegramRiskReport({
        mode: env.mode,
        startedAt,
        reportAt: new Date(),
        warningsCount,
        errorsCount,
        pnl: {
          realizedPeriod: report.realizedPnl,
          realizedCumulative: cumulativeRealized,
          unrealizedFairBased,
          estimatedMakerRebate: report.estimatedRebate,
          estimatedTotalPnl,
          valuationMode: 'fair',
        },
        activity,
        risk: {
          status: globalRiskStatus,
          reasons: aggregatedReasons,
          reduceOnlyActive: aggregatedReduceOnly,
          killSwitchActive: false,
          openPositions: openPositionsCount,
          topMarketDecision: topDecision,
          topInventoryDecisions,
          timeInNonOkStatusMs,
          riskTrajectory,
          singleMarketConcentrationPct: activity.primaryMarketQuoteSharePct,
          unrealizedToRealizedRatio,
        },
        marketTitleByConditionId,
      });

      await telegram.sendMessage(text);
      scheduleReport(hourUtc);
    }, delay);
  }

  for (const hour of REPORT_HOURS_UTC) {
    scheduleReport(hour);
  }

  logger.info('Paper trading active. Press Ctrl+C to stop.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
