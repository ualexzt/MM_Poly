import 'dotenv/config';

export interface EnvConfig {
  nodeEnv: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  mode: 'paper' | 'shadow' | 'small_live' | 'disabled';
  minLiquidityUsd: number;
  minVolume24hUsd: number;
  maxSpreadCents: number;
  minSpreadTicks: number;
  toxicityCancelIfSpreadTicksLte: number;
  maxOrderSizeUsd: number;
  minQuoteLifetimeMs: number;
  maxQuoteLifetimeMs: number;
  maxExposureUsd: number;
  maxDrawdownPct: number;
  dailyReportHour: number;
  dailyReportMinute: number;
  telegramReportIntervalHours: number;
  maxMarkets: number;
  liveTradingEnabled: boolean;
  privateKey?: string;
  clobApiKey?: string;
  clobApiSecret?: string;
  clobApiPassphrase?: string;
  relayerApiKey?: string;
  relayerApiKeyAddress?: string;
  walletAddress?: string;
  smallLiveRiskStatus: 'OK' | 'WARNING' | 'CRITICAL';
  smallLiveRiskReasons: string[];
  smallLiveRealizedPnlExRebatesUsd: number;
  smallLiveWorstTopInventoryExitPnlUsd: number | null;
  smallLiveTestsPassing: boolean;
  smallLiveBuildPassing: boolean;

  // Binance config
  binanceWsUrl: string;
  binanceSymbols: string[];

  // Latency arb config
  latencyArbEnabled: boolean;
  latencyArbMinConfidence: number;
  latencyArbMaxPositionUsd: number;
  latencyArbMaxDailyTrades: number;
  latencyArbCooldownMs: number;
  latencyArbMarketAsset: 'BTC';
  latencyArbMarketDurationMinutes: number;
  latencyArbStartingBalanceUsd: number;
  latencyArbOrderBalanceFraction: number;
  latencyArbMaxOrderSizeUsd: number;
  latencyArbMaxSpreadCents: number;
  latencyArbMaxMarketAgeMs: number;
  latencyArbSimulatedLatencyMs: number;
  latencyArbLogDir: string;
}

function getEnv(key: string, defaultValue?: string): string {
  const val = process.env[key];
  if (val === undefined) {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return val;
}

function parseStrictNumber(key: string, val: string): number {
  const trimmed = val.trim();
  if (trimmed === '') throw new Error(`Invalid float for ${key}: ${val}`);
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid float for ${key}: ${val}`);
  return parsed;
}

function getEnvInt(key: string, defaultValue: number): number {
  const val = process.env[key];
  if (val === undefined) return defaultValue;
  const parsed = parseStrictNumber(key, val);
  if (!Number.isInteger(parsed)) throw new Error(`Invalid integer for ${key}: ${val}`);
  return parsed;
}

function getEnvFloat(key: string, defaultValue: number): number {
  const val = process.env[key];
  if (val === undefined) return defaultValue;
  return parseStrictNumber(key, val);
}

function getEnvPositiveInt(key: string, defaultValue: number): number {
  const parsed = getEnvInt(key, defaultValue);
  if (parsed <= 0) throw new Error(`Invalid positive integer for ${key}: ${parsed}`);
  return parsed;
}

function getEnvNonNegativeInt(key: string, defaultValue: number): number {
  const parsed = getEnvInt(key, defaultValue);
  if (parsed < 0) throw new Error(`Invalid non-negative integer for ${key}: ${parsed}`);
  return parsed;
}

function getEnvPositiveFloat(key: string, defaultValue: number): number {
  const parsed = getEnvFloat(key, defaultValue);
  if (parsed <= 0) throw new Error(`Invalid positive float for ${key}: ${parsed}`);
  return parsed;
}

function getEnvNonNegativeFloat(key: string, defaultValue: number): number {
  const parsed = getEnvFloat(key, defaultValue);
  if (parsed < 0) throw new Error(`Invalid non-negative float for ${key}: ${parsed}`);
  return parsed;
}

function getEnvRatio(key: string, defaultValue: number): number {
  const parsed = getEnvFloat(key, defaultValue);
  if (parsed <= 0 || parsed > 1) throw new Error(`Invalid ratio for ${key}: ${parsed}`);
  return parsed;
}

function getEnvNonEmptyString(key: string, defaultValue: string): string {
  const val = getEnv(key, defaultValue).trim();
  if (val.length === 0) throw new Error(`Invalid non-empty string for ${key}`);
  return val;
}

function getEnvBool(key: string, defaultValue: boolean): boolean {
  const val = process.env[key];
  if (val === undefined) return defaultValue;
  if (val === 'true') return true;
  if (val === 'false') return false;
  throw new Error(`Invalid boolean for ${key}: ${val}`);
}

function getEnvNullableFloat(key: string, defaultValue: number | null): number | null {
  const val = process.env[key];
  if (val === undefined || val.trim() === '') return defaultValue;
  if (val === 'null') return null;
  return parseStrictNumber(key, val);
}

function getEnvRiskStatus(key: string, defaultValue: 'OK' | 'WARNING' | 'CRITICAL'): 'OK' | 'WARNING' | 'CRITICAL' {
  const val = process.env[key];
  if (val === undefined) return defaultValue;
  if (val === 'OK' || val === 'WARNING' || val === 'CRITICAL') return val;
  throw new Error(`Invalid risk status for ${key}: ${val}`);
}

function getEnvLatencyAsset(key: string, defaultValue: 'BTC'): 'BTC' {
  const val = process.env[key];
  if (val === undefined) return defaultValue;
  if (val === 'BTC') return val;
  throw new Error(`Invalid latency arb asset for ${key}: ${val}`);
}

function getEnvList(key: string, defaultValue: string[]): string[] {
  const val = process.env[key];
  if (val === undefined || val.trim() === '') return defaultValue;
  return val.split(',').map((v) => v.trim()).filter((v) => v.length > 0);
}

export const env: EnvConfig = {
  nodeEnv: getEnv('NODE_ENV', 'development'),
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,
  mode: getEnv('MODE', 'paper') as EnvConfig['mode'],
  minLiquidityUsd: getEnvFloat('MIN_LIQUIDITY_USD', 5000),
  minVolume24hUsd: getEnvFloat('MIN_VOLUME_24H_USD', 10000),
  maxSpreadCents: getEnvFloat('MAX_SPREAD_CENTS', 8),
  minSpreadTicks: getEnvInt('MIN_SPREAD_TICKS', 3),
  toxicityCancelIfSpreadTicksLte: getEnvInt('TOXICITY_CANCEL_IF_SPREAD_TICKS_LTE', 1),
  maxOrderSizeUsd: getEnvFloat('MAX_ORDER_SIZE_USD', 1.5),
  minQuoteLifetimeMs: getEnvInt('MIN_QUOTE_LIFETIME_MS', 500),
  maxQuoteLifetimeMs: getEnvInt('MAX_QUOTE_LIFETIME_MS', 10_000),
  maxExposureUsd: getEnvFloat('MAX_EXPOSURE_USD', 10),
  maxDrawdownPct: getEnvFloat('MAX_DRAWDOWN_PCT', 0.02),
  dailyReportHour: getEnvInt('DAILY_REPORT_HOUR', 20),
  dailyReportMinute: getEnvInt('DAILY_REPORT_MINUTE', 0),
  telegramReportIntervalHours: getEnvFloat('TELEGRAM_REPORT_INTERVAL_HOURS', 3),
  maxMarkets: getEnvInt('MAX_MARKETS', 2),
  liveTradingEnabled: getEnvBool('LIVE_TRADING_ENABLED', false),
  privateKey: process.env.PRIVATE_KEY,
  clobApiKey: process.env.CLOB_API_KEY,
  clobApiSecret: process.env.CLOB_API_SECRET,
  clobApiPassphrase: process.env.CLOB_API_PASSPHRASE,
  relayerApiKey: process.env.RELAYER_API_KEY,
  relayerApiKeyAddress: process.env.RELAYER_API_KEY_ADDRESS,
  walletAddress: process.env.WALLET_ADDRESS,
  smallLiveRiskStatus: getEnvRiskStatus('SMALL_LIVE_RISK_STATUS', 'CRITICAL'),
  smallLiveRiskReasons: getEnvList('SMALL_LIVE_RISK_REASONS', []),
  smallLiveRealizedPnlExRebatesUsd: getEnvFloat('SMALL_LIVE_REALIZED_PNL_EX_REBATES_USD', 0),
  smallLiveWorstTopInventoryExitPnlUsd: getEnvNullableFloat('SMALL_LIVE_WORST_TOP_INVENTORY_EXIT_PNL_USD', null),
  smallLiveTestsPassing: getEnvBool('SMALL_LIVE_TESTS_PASSING', false),
  smallLiveBuildPassing: getEnvBool('SMALL_LIVE_BUILD_PASSING', false),

  // Binance config
  binanceWsUrl: getEnv('BINANCE_WS_URL', 'wss://stream.binance.com:9443'),
  binanceSymbols: getEnvList('BINANCE_SYMBOLS', ['btcusdt', 'ethusdt']),

  // Latency arb config
  latencyArbEnabled: getEnvBool('LATENCY_ARB_ENABLED', false),
  latencyArbMinConfidence: getEnvFloat('LATENCY_ARB_MIN_CONFIDENCE', 0.6),
  latencyArbMaxPositionUsd: getEnvFloat('LATENCY_ARB_MAX_POSITION_USD', 50),
  latencyArbMaxDailyTrades: getEnvInt('LATENCY_ARB_MAX_DAILY_TRADES', 20),
  latencyArbCooldownMs: getEnvInt('LATENCY_ARB_COOLDOWN_MS', 60000),
  latencyArbMarketAsset: getEnvLatencyAsset('LATENCY_ARB_MARKET_ASSET', 'BTC'),
  latencyArbMarketDurationMinutes: getEnvPositiveInt('LATENCY_ARB_MARKET_DURATION_MINUTES', 15),
  latencyArbStartingBalanceUsd: getEnvPositiveFloat('LATENCY_ARB_STARTING_BALANCE_USD', 15.48),
  latencyArbOrderBalanceFraction: getEnvRatio('LATENCY_ARB_ORDER_BALANCE_FRACTION', 0.10),
  latencyArbMaxOrderSizeUsd: getEnvPositiveFloat('LATENCY_ARB_MAX_ORDER_SIZE_USD', 1.55),
  latencyArbMaxSpreadCents: getEnvNonNegativeFloat('LATENCY_ARB_MAX_SPREAD_CENTS', 8),
  latencyArbMaxMarketAgeMs: getEnvNonNegativeInt('LATENCY_ARB_MAX_MARKET_AGE_MS', 2000),
  latencyArbSimulatedLatencyMs: getEnvNonNegativeInt('LATENCY_ARB_SIMULATED_LATENCY_MS', 750),
  latencyArbLogDir: getEnvNonEmptyString('LATENCY_ARB_LOG_DIR', 'logs'),
};
