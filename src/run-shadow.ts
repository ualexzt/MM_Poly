import { WsMarketStream } from './data/ws-market-stream';
import { GammaApiScanner } from './data/gamma-market-scanner';
import { ClobApiClient } from './data/clob-orderbook-client';
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

const TELEGRAM_BOT_TOKEN = '8751621772:AAHRSaBaX9TjEPrbpuRbhVl51x9DyX2_U2M';
const TELEGRAM_CHAT_ID = '-1003826664092';
const TELEGRAM_COOLDOWN_MS = 60000; // 1 min between alerts for same market

async function main() {
  const logger = new ConsoleLogger();
  const telegram = new TelegramNotifier({ botToken: TELEGRAM_BOT_TOKEN, chatId: TELEGRAM_CHAT_ID });
  const scanner = new GammaApiScanner();
  const bookClient = new ClobApiClient();
  const killSwitch = new KillSwitch(defaultConfig.risk);

  logger.info('=== Polymarket MM Strategy — Shadow Mode ===');
  logger.info('Mode: shadow (calculating quotes, NOT placing orders)');
  logger.info('Data source: WebSocket live stream');

  await telegram.sendMessage('🚀 <b>Polymarket Bot started</b>\nMode: SHADOW\nData: WebSocket live stream');

  let markets: MarketState[] = [];
  let eligible: MarketState[] = [];
  const books = new Map<string, BookState>();
  const lastAlert = new Map<string, number>();

  try {
    markets = await scanner.fetchMarkets();
    eligible = filterEligibleMarkets(markets, defaultConfig.marketFilter);
    logger.info(`Loaded ${markets.length} markets, ${eligible.length} eligible`);
  } catch (err) {
    logger.error('Failed to load markets', { error: String(err) });
    process.exit(1);
  }

  const tokenIds = eligible.flatMap(m => [m.yesTokenId, m.noTokenId]).filter(Boolean);

  // Pre-fetch initial books via REST for immediate evaluation
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

  function evaluateMarket(market: MarketState) {
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

    const toxicityScore = 0.1;
    const inventorySkew = 0;

    for (const side of ['BUY', 'SELL'] as const) {
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
        const trace = createTrace({
          mode: 'shadow',
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
          inventoryPct: 0,
          inventorySkewCents: inventorySkew,
          targetPrice: quote.price,
          targetSizeUsd: quote.sizeUsd,
          decision: 'quote',
          reason: quote.reason,
          riskFlags: quote.riskFlags
        });

        logger.trace(trace);

        // Telegram cooldown to avoid spam
        const alertKey = `${market.conditionId}-${side}`;
        const last = lastAlert.get(alertKey) || 0;
        if (Date.now() - last > TELEGRAM_COOLDOWN_MS) {
          lastAlert.set(alertKey, Date.now());
          telegram.sendTradeAlert({
            question: market.question || market.conditionId,
            side,
            price: quote.price,
            size: quote.size,
            fairPrice: yesFair.fairPrice,
            spread: yesBook.spread || 0,
            slug: market.slug
          }).catch(() => {}); // non-blocking
        }
      }
    }
  }

  // Evaluate all markets with initial books
  for (const market of eligible.slice(0, 5)) {
    evaluateMarket(market);
  }

  // WebSocket streaming — no polling
  const ws = new WsMarketStream(
    'wss://ws-subscriptions-clob.polymarket.com/ws/market',
    (update) => {
      if (update.book) {
        books.set(update.tokenId, update.book);
        const market = eligible.find(m => m.yesTokenId === update.tokenId || m.noTokenId === update.tokenId);
        if (market) evaluateMarket(market);
      }
    },
    (err) => logger.error('WS error', { error: err.message })
  );

  ws.connect(tokenIds.slice(0, 10)); // limit to 10 tokens for WS

  logger.info('Shadow mode active via WebSocket. Press Ctrl+C to stop.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
