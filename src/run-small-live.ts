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
import {
  buildSmallLiveConfig,
  buildTokenConditionMap,
  cancelAllLiveOrders,
  createSmallLiveStrategyRunner,
  handleLiveUserEvent,
} from './strategy/small-live-runner';

const logger = new ConsoleLogger();

async function main() {
  logger.info('=== Polymarket MM Strategy — Small Live Init ===');

  // Validate credentials
  if (!env.privateKey) {
    logger.error('Missing PRIVATE_KEY in environment');
    process.exit(1);
  }
  if (!env.clobApiKey || !env.clobApiSecret || !env.clobApiPassphrase) {
    logger.error('Missing CLOB API credentials. Run: npm run generate:clob-key');
    process.exit(1);
  }
  if (env.privateKey.length !== 66) {
    logger.error('PRIVATE_KEY looks invalid. Must be 0x + 64 hex characters.');
    process.exit(1);
  }
  if (env.mode !== 'small_live') {
    logger.error('Refusing live start: MODE must be small_live', { mode: env.mode });
    process.exit(1);
  }
  if (!env.liveTradingEnabled) {
    logger.error('Refusing live start: LIVE_TRADING_ENABLED must be true');
    process.exit(1);
  }

  // Initialize CLOB client
  const account = privateKeyToAccount(env.privateKey as `0x${string}`);
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
      key: env.clobApiKey,
      secret: env.clobApiSecret,
      passphrase: env.clobApiPassphrase,
    },
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
  const config = buildSmallLiveConfig(env);
  const scanner = new GammaApiScanner();
  const initialMarkets = await scanner.fetchMarkets();
  const tokenConditionIds = buildTokenConditionMap(initialMarkets);
  const pnlTracker = new PaperPnlTracker(0);
  const runner = createSmallLiveStrategyRunner({
    envConfig: env,
    scanner: { fetchMarkets: async () => initialMarkets },
    bookClient: new ClobApiClient(),
    paperEngine: new PaperExecutionEngine(config.paperExecution),
    liveSubmitter,
    logger,
  });

  const userStream = new WsUserStream(
    'wss://ws-subscriptions-clob.polymarket.com/ws/user',
    env.clobApiKey,
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
      await runner.runCycle(userStream.getConnectionStatus());
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
    try {
      userStream.disconnect();
      await cancelAllLiveOrders(liveSubmitter, logger);
    } catch (err) {
      logger.error('Live shutdown cancel-all failed', { error: String(err) });
    } finally {
      process.exit(0);
    }
  };

  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });
}

main().catch((err) => {
  logger.error('Fatal error', { error: String(err) });
  process.exit(1);
});
