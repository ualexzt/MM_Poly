import type { EnvConfig } from '../config/env';
import type { MarketScanner } from '../data/gamma-market-scanner';
import type { OrderbookClient } from '../data/clob-orderbook-client';
import { PaperExecutionEngine } from '../simulation/paper-execution-engine';
import { LiveOrderSubmitter } from '../execution/live-order-submitter';
import type { Logger } from '../utils/logger';
import type { StrategyConfig } from '../types/config';
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
  });
}
