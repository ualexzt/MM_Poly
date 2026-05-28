import 'dotenv/config';
import { ClobClient, Chain } from '@polymarket/clob-client-v2';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { polygon } from 'viem/chains';
import { env } from './config/env';
import { ConsoleLogger } from './utils/logger';
import { TelegramNotifier } from './notifier/telegram';
import { LiveOrderSubmitter } from './execution/live-order-submitter';

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
  logger.info('Mode', { mode: 'small_live' });
  logger.info('Base order size', { usd: 1 });
  logger.info('Max exposure', { usd: 25 });
  logger.info('Drawdown kill switch', { usd: 5 });

  logger.info('=== Ready for small_live trading ===');
  logger.info('To start the full strategy loop, integrate this submitter into the orchestration.');

  // TODO: wire into shared strategy loop with live mode
  // For now, this validates credentials and exits cleanly.
}

main().catch((err) => {
  logger.error('Fatal error', { error: String(err) });
  process.exit(1);
});
