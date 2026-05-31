import 'dotenv/config';
import { ClobClient, Chain } from '@polymarket/clob-client-v2';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { polygon } from 'viem/chains';
import { env } from './config/env';
import { GammaApiScanner } from './data/gamma-market-scanner';
import { ClobApiClient } from './data/clob-orderbook-client';
import { WsUserStream } from './data/ws-user-stream';
import { PaperExecutionEngine } from './simulation/paper-execution-engine';
import { PaperPnlTracker } from './accounting/paper-pnl-tracker';
import { ConsoleLogger } from './utils/logger';
import { LiveOrderSubmitter } from './execution/live-order-submitter';
import { DataApiClient } from './data/data-api-client';
import { TelegramNotifier } from './notifier/telegram';
import { SmallLiveMetrics } from './monitoring/small-live-metrics';
import { formatSmallLiveAlert, formatSmallLiveTelegramReport } from './reporting/small-live-telegram-report';
import {
  buildSmallLiveConfig,
  cancelAllLiveOrders,
  ensureNoOpenLiveOrders,
  createSmallLiveStrategyRunner,
  createTrackingMarketScanner,
  handleLiveUserEvent,
  shouldSendSmallLiveReport,
  calculateOpenOrderNotionalUsd,
} from './strategy/small-live-runner';
import { buildGoNoGoStartupBlockersFromEnv, notifyStartupBlockers, validateSmallLiveStartupEnv } from './strategy/small-live-preflight';

const logger = new ConsoleLogger();

async function main() {
  logger.info('=== Polymarket MM Strategy — Small Live Init ===');

  // Validate credentials and startup safety gates before any live action.
  const envValidation = validateSmallLiveStartupEnv(env);
  if (!envValidation.ok) {
    logger.error('Refusing live start: startup preflight failed', { blockers: envValidation.blockers });
    await notifyStartupBlockers(envValidation.blockers, env, logger);
    process.exit(1);
  }

  const privateKey = env.privateKey as `0x${string}`;
  const clobApiKey = env.clobApiKey as string;
  const clobApiSecret = env.clobApiSecret as string;
  const clobApiPassphrase = env.clobApiPassphrase as string;
  const walletAddress = env.walletAddress as string;

  // Initialize CLOB client
  const account = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({
    account,
    chain: polygon,
    transport: http(),
  });

  const clobClient = new ClobClient({
    host: 'https://clob.polymarket.com',
    chain: Chain.POLYGON,
    signer: walletClient,
    creds: {
      key: clobApiKey,
      secret: clobApiSecret,
      passphrase: clobApiPassphrase,
    },
    signatureType: 3, // POLY_1271 — deposit wallet flow for API traders
    funderAddress: walletAddress,
  });

  // Test connectivity
  try {
    const orderBook = await clobClient.getOrderBook('0x');
    logger.info('CLOB API connected', { status: 'ok' });
  } catch (err) {
    logger.warn('CLOB API test call failed (expected for dummy token)', { error: String(err) });
  }

  const liveSubmitter = new LiveOrderSubmitter(clobClient as any);

  logger.info('Live order submitter initialized');
  logger.info('Wallet address', { address: account.address });

  const startupCancel = await ensureNoOpenLiveOrders(liveSubmitter, env, logger, notifyStartupBlockers);
  if (!startupCancel.ok) {
    logger.error('Refusing live start: failed to cancel existing live orders', startupCancel.cancelResult ? { ...startupCancel.cancelResult } : undefined);
    process.exit(1);
  }
  logger.info('Startup live order cleanup complete', { ...startupCancel.cancelResult });

  const goNoGoBlockers = buildGoNoGoStartupBlockersFromEnv(env);
  if (goNoGoBlockers.length > 0) {
    logger.error('Refusing live start: small_live go/no-go failed', { blockers: goNoGoBlockers });
    await notifyStartupBlockers(goNoGoBlockers, env, logger);
    process.exit(1);
  }

  const config = buildSmallLiveConfig(env);
  const telegram = env.telegramBotToken && env.telegramChatId
    ? new TelegramNotifier({ botToken: env.telegramBotToken, chatId: env.telegramChatId })
    : null;
  const metrics = new SmallLiveMetrics();
  let lastReportAtMs = Date.now();
  let lastOpenOrdersCount = 0;
  let lastOpenOrderNotionalUsd = 0;
  const tokenConditionIds = new Map<string, string>();
  const scanner = createTrackingMarketScanner(new GammaApiScanner(), tokenConditionIds);
  const initialMarkets = await scanner.fetchMarkets();
  const pnlTracker = new PaperPnlTracker(0);
  const runner = createSmallLiveStrategyRunner({
    envConfig: env,
    scanner,
    bookClient: new ClobApiClient(),
    paperEngine: new PaperExecutionEngine(config.paperExecution),
    liveSubmitter,
    logger,
  });

  // Position reconciliation from Polymarket Data API is mandatory for small_live.
  const dataApi = new DataApiClient('https://data-api.polymarket.com', walletAddress);
  try {
    const positions = await dataApi.fetchPositions();
    logger.info('Loaded positions from Data API', { count: positions.length });
    runner.getInventory().loadPositions(
      positions.map(p => ({ tokenId: p.tokenId, size: p.size, avgPrice: p.avgPrice }))
    );
  } catch (err) {
    logger.error('Refusing live start: failed to load positions from Data API', { error: String(err) });
    await notifyStartupBlockers(['position_reconciliation_failed'], env, logger);
    process.exit(1);
  }

  const userStream = new WsUserStream(
    'wss://ws-subscriptions-clob.polymarket.com/ws/user',
    { apiKey: clobApiKey, secret: env.clobApiSecret ?? '', passphrase: env.clobApiPassphrase ?? '' },
    (event) => {
      if (event.type === 'connect') logger.info('User stream connected');
      if (event.type === 'disconnect') logger.warn('User stream disconnected');
      handleLiveUserEvent(event, { runner, pnlTracker, tokenConditionIds, logger });
    },
    (err) => logger.error('User stream error', { error: err.message })
  );

  logger.info('Mode', { mode: config.mode, liveTradingEnabled: config.liveTradingEnabled });
  logger.info('Base order size', { usd: config.size.baseOrderSizeUsd });
  logger.info('Max order size', { usd: config.size.maxOrderSizeUsd });
  logger.info('Max exposure', { usd: config.inventory.maxTotalStrategyExposureUsd });
  logger.info('Drawdown kill switch', { usd: config.risk.maxDailyDrawdownUsd });
  logger.info('Initial live market universe', { markets: initialMarkets.length, trackedTokens: tokenConditionIds.size, maxMarkets: env.maxMarkets });

  if (telegram) {
    await telegram.sendMessage(formatSmallLiveAlert({
      severity: config.mode === 'small_live' && config.liveTradingEnabled ? 'CRITICAL' : 'INFO',
      title: 'Bot started',
      detail: `Mode=${config.mode}, liveTradingEnabled=${config.liveTradingEnabled}, maxMarkets=${env.maxMarkets}`,
    }));
  }

  userStream.connect();
  logger.info('=== Starting small_live strategy loop ===');

  let cycleInFlight = false;
  const runOneCycle = async () => {
    if (cycleInFlight) {
      logger.warn('Skipping small_live cycle because prior cycle is still running');
      return;
    }

    cycleInFlight = true;
    try {
      const cycleStartedAtMs = Date.now();

      if (config.mode === 'small_live' && config.liveTradingEnabled) {
        const openOrders = await liveSubmitter.getOpenOrders();
        const openOrderNotionalUsd = calculateOpenOrderNotionalUsd(openOrders);
        lastOpenOrdersCount = openOrders.length;
        lastOpenOrderNotionalUsd = openOrderNotionalUsd;

        if (openOrderNotionalUsd > env.maxExposureUsd) {
          if (telegram) {
            await telegram.sendMessage(formatSmallLiveAlert({
              severity: 'CRITICAL',
              title: 'Open order exposure above limit',
              detail: `openOrderNotionalUsd=${openOrderNotionalUsd.toFixed(2)}, maxExposureUsd=${env.maxExposureUsd}`,
            }));
          }
          logger.error('Skipping small_live cycle: open order exposure above limit', {
            openOrderNotionalUsd,
            maxExposureUsd: env.maxExposureUsd,
          });
          return;
        }
      }

      await runner.runCycle(userStream.getConnectionStatus());
      metrics.recordCycleLag(Date.now() - cycleStartedAtMs);

      const now = Date.now();
      if (telegram && shouldSendSmallLiveReport(lastReportAtMs, now, env.telegramReportIntervalHours)) {
        const snap = metrics.reset();
        const inventory = runner.getInventory();
        await telegram.sendMessage(formatSmallLiveTelegramReport({
          mode: config.mode,
          reportAt: new Date(now),
          balanceUsd: inventory.getPusdAvailable(),
          openOrdersCount: lastOpenOrdersCount,
          openOrdersNotionalUsd: lastOpenOrderNotionalUsd,
          positionsCount: 0,
          positionsValueUsd: inventory.getTotalExposureUsd(),
          realizedPnlUsd: 0,
          unrealizedPnlUsd: 0,
          fillsCount: snap.matchedSubmits,
          rejectsCount: Object.values(snap.rejects).reduce((sum, value) => sum + value, 0),
          activeMarkets: env.maxMarkets,
          riskState: 'OK',
        }));
        lastReportAtMs = now;
      }
    } catch (err) {
      logger.error('small_live cycle failed', { error: String(err) });
    } finally {
      cycleInFlight = false;
    }
  };

  await runOneCycle();
  const interval = setInterval(runOneCycle, config.refreshIntervalMs);

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(interval);
    logger.warn('Small_live shutdown requested; cancelling live orders');
    let exitCode = 0;
    try {
      userStream.disconnect();
      const shutdownCancel = await cancelAllLiveOrders(liveSubmitter, logger);
      if (shutdownCancel.failed > 0) exitCode = 1;
    } catch (err) {
      exitCode = 1;
      logger.error('Live shutdown cancel-all failed', { error: String(err) });
    } finally {
      process.exit(exitCode);
    }
  };

  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });
}

main().catch((err) => {
  logger.error('Fatal error', { error: String(err) });
  process.exit(1);
});
