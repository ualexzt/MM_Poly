import 'dotenv/config';
import { env } from './config/env';
import { LatencyArbStrategy } from './strategy/latency-arb-strategy';
import { ConsoleLogger } from './utils/logger';

const logger = new ConsoleLogger();

async function main() {
  logger.info('=== Latency Arbitrage Strategy ===');

  if (!env.latencyArbEnabled) {
    logger.info('Latency arb is disabled. Set LATENCY_ARB_ENABLED=true to run.');
    process.exit(0);
  }

  const strategy = new LatencyArbStrategy({
    symbols: env.binanceSymbols,
    minConfidence: env.latencyArbMinConfidence,
    maxPositionSizeUsd: env.latencyArbMaxPositionUsd,
    maxDailyTrades: env.latencyArbMaxDailyTrades,
    cooldownMs: env.latencyArbCooldownMs,
    mode: env.mode as 'paper' | 'shadow' | 'small_live',
  });

  // Handle shutdown
  process.on('SIGINT', () => {
    logger.info('Shutting down...');
    strategy.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    logger.info('Shutting down...');
    strategy.stop();
    process.exit(0);
  });

  // Start strategy
  strategy.start();

  // Log stats periodically
  setInterval(() => {
    const stats = strategy.getStats();
    logger.info('Strategy stats', stats);
  }, 60000); // Every minute
}

main().catch(err => {
  logger.error('Fatal error', { error: String(err) });
  process.exit(1);
});
