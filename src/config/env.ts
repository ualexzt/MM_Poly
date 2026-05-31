import 'dotenv/config';

export interface EnvConfig {
  nodeEnv: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  mode: 'paper' | 'shadow' | 'small_live' | 'disabled';
  minLiquidityUsd: number;
  minVolume24hUsd: number;
  maxSpreadCents: number;
  maxExposureUsd: number;
  maxDrawdownPct: number;
  dailyReportHour: number;
  dailyReportMinute: number;
  telegramReportIntervalHours?: number;
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
};
