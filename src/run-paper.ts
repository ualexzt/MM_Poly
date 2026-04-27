import 'dotenv/config';
import { env } from './config/env';
import { WsMarketStream } from './data/ws-market-stream';
import { GammaApiScanner } from './data/gamma-market-scanner';
import { ClobApiClient } from './data/clob-orderbook-client';
import { PaperExecutionEngine } from './simulation/paper-execution-engine';
import { PaperPnlTracker } from './accounting/paper-pnl-tracker';
import { defaultConfig } from './strategy/config';
import { ConsoleLogger } from './utils/logger';
import { TelegramNotifier } from './notifier/telegram';
import { computeFairPrice } from './engines/fair-price-engine';
import { filterEligibleMarkets } from './strategy/market-selector';
import { generateQuoteCandidates } from './engines/quote-engine';
import { createTrace } from './accounting/decision-trace';
import { KillSwitch } from './risk/kill-switch';
import { isBookStale } from './risk/stale-book-guard';
import { BookState } from './types/book';
import { MarketState } from './types/market';

const QUOTE_COOLDOWN_MS = 10000;   // 10 sec between quote recalculation per market
const ORDER_TTL_MS = 60000;        // 60 sec max lifetime for an order before replace
const PRICE_EPSILON = 0.005;       // half tick — treat as same price
const WS_TOKEN_LIMIT = 10;
// Kyiv time reports: 08:00 and 20:00 Kyiv = 05:00 and 17:00 UTC
const REPORT_HOURS_UTC = [5, 17];

interface ActiveOrder {
  orderId: string;
  price: number;
  size: number;
  submittedAt: number;
}

async function main() {
  const logger = new ConsoleLogger();
  const telegram = new TelegramNotifier({ botToken: env.telegramBotToken, chatId: env.telegramChatId });
  const scanner = new GammaApiScanner();
  const bookClient = new ClobApiClient();
  const paperEngine = new PaperExecutionEngine();
  const pnlTracker = new PaperPnlTracker();
  const killSwitch = new KillSwitch(defaultConfig.risk);

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
  const activeOrders = new Map<string, { buy: ActiveOrder | null; sell: ActiveOrder | null }>();

  try {
    markets = await scanner.fetchMarkets();
    eligible = filterEligibleMarkets(markets, defaultConfig.marketFilter);
    logger.info(`Loaded ${markets.length} markets, ${eligible.length} eligible`);
  } catch (err) {
    logger.error('Failed to load markets', { error: String(err) });
    process.exit(1);
  }

  const tokenIds = eligible.flatMap(m => [m.yesTokenId, m.noTokenId]).filter(Boolean);

  // Pre-fetch initial books
  for (const market of eligible.slice(0, 5)) {
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
      logger.warn('Initial book fetch failed', { conditionId: market.conditionId, error: String(err) });
    }
  }

  function getInventorySkew(tokenId: string): number {
    const pos = pnlTracker.getPosition(tokenId);
    if (!pos || pos.netSize === 0) return 0;
    const maxPos = env.maxExposureUsd / 100;
    const skew = Math.tanh(pos.netSize / maxPos) * defaultConfig.spread.baseHalfSpreadCents;
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
    if (isBookStale(yesBook.lastUpdateMs, defaultConfig.staleOrderMaxAgeMs)) return;

    const yesFair = computeFairPrice({
      bestBid: yesBook.bestBid || 0, bestAsk: yesBook.bestAsk || 0,
      bestBidSize: yesBook.bestBidSizeUsd, bestAskSize: yesBook.bestAskSizeUsd,
      lastTradeEma: yesBook.lastTradePrice || null,
      complementMidpoint: noBook.midpoint,
      weights: defaultConfig.fairPrice.weights
    });
    if (!yesFair) return;

    // Always simulate fills if a trade price came through WS
    // We do NOT cancel orders before fill check — they sit in the book like real orders
    if (tradePrice !== undefined) {
      const fills = paperEngine.onTrade({ tokenId: market.yesTokenId, price: tradePrice, size: 8 });
      for (const fill of fills) {
        pnlTracker.onFill(fill, yesFair.fairPrice);
        logger.info('Paper fill', {
          side: fill.side,
          price: fill.filledPrice,
          size: fill.filledSize,
          remaining: fill.remainingSize,
          pnl: pnlTracker.getPosition(fill.tokenId)?.realizedPnl?.toFixed(2)
        });
      }
    }

    // Quote cooldown: skip recalculation if < 10s since last quote for this market
    const now = Date.now();
    const lastQuote = lastQuoteTime.get(market.conditionId) || 0;
    if (now - lastQuote < QUOTE_COOLDOWN_MS) return;
    lastQuoteTime.set(market.conditionId, now);

    const toxicityScore = 0.1;
    const inventorySkew = getInventorySkew(market.yesTokenId);

    let ao = activeOrders.get(market.conditionId);
    if (!ao) {
      ao = { buy: null, sell: null };
      activeOrders.set(market.conditionId, ao);
    }

    for (const side of ['BUY', 'SELL'] as const) {
      const aoKey = side === 'BUY' ? 'buy' : 'sell';
      const quotes = generateQuoteCandidates({
        conditionId: market.conditionId,
        tokenId: market.yesTokenId,
        side,
        fairPrice: yesFair.fairPrice,
        targetHalfSpreadCents: defaultConfig.spread.baseHalfSpreadCents,
        inventorySkewCents: inventorySkew,
        toxicityScore,
        book: yesBook,
        baseSizeUsd: defaultConfig.size.baseOrderSizeUsd,
        maxSizeUsd: defaultConfig.size.maxOrderSizeUsd,
        minOrderSize: yesBook.minOrderSize,
        isBookStale: false
      });

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
          inventoryPct: Math.abs(inventorySkew) / defaultConfig.spread.baseHalfSpreadCents,
          inventorySkewCents: inventorySkew,
          targetPrice: quote.price,
          targetSizeUsd: quote.sizeUsd,
          decision: 'quote',
          reason: quote.reason,
          riskFlags: quote.riskFlags
        });

        logger.trace(trace);
      }
    }
  }

  // Initial evaluation
  for (const market of eligible.slice(0, 5)) {
    evaluateMarket(market);
  }

  // WebSocket
  const ws = new WsMarketStream(
    'wss://ws-subscriptions-clob.polymarket.com/ws/market',
    (update) => {
      if (update.book) {
        books.set(update.tokenId, update.book);
        const market = eligible.find(m => m.yesTokenId === update.tokenId || m.noTokenId === update.tokenId);
        if (market) {
          const tradePrice = update.lastTradePrice ?? undefined;
          evaluateMarket(market, tradePrice);
        }
      }
    },
    (err) => logger.error('WS error', { error: err.message })
  );

  ws.connect(tokenIds.slice(0, WS_TOKEN_LIMIT));

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

      const text = `
📊 <b>Paper Trading Report — ${report.date}</b>

<b>Realized PnL:</b> $${report.realizedPnl.toFixed(2)}
<b>Unrealized PnL:</b> $${report.unrealizedPnl.toFixed(2)}
<b>Est. Maker Rebate:</b> $${report.estimatedRebate.toFixed(2)}
<b>Spread Capture:</b> $${report.spreadCapture.toFixed(2)}
<b>Open Positions:</b> ${report.openPositions}
<b>Total Trades:</b> ${report.totalTrades}

<i>Paper mode — no real money at risk</i>
      `.trim();

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
