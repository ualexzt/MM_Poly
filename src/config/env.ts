import 'dotenv/config';

export interface EnvConfig {
  nodeEnv: string;
  telegramBotToken: string;
  telegramChatId: string;
  mode: 'paper' | 'shadow' | 'small_live' | 'disabled';
  minLiquidityUsd: number;
  minVolume24hUsd: number;
  maxSpreadCents: number;
  maxExposureUsd: number;
  maxDrawdownPct: number;
  dailyReportHour: number;
  dailyReportMinute: number;
}

function getEnv(key: string, defaultValue?: string): string {
  const val = process.env[key];
  if (val === undefined) {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return val;
}

function getEnvInt(key: string, defaultValue: number): number {
  const val = process.env[key];
  if (val === undefined) return defaultValue;
  const parsed = parseInt(val, 10);
  if (isNaN(parsed)) throw new Error(`Invalid integer for ${key}: ${val}`);
  return parsed;
}

function getEnvFloat(key: string, defaultValue: number): number {
  const val = process.env[key];
  if (val === undefined) return defaultValue;
  const parsed = parseFloat(val);
  if (isNaN(parsed)) throw new Error(`Invalid float for ${key}: ${val}`);
  return parsed;
}

export const env: EnvConfig = {
  nodeEnv: getEnv('NODE_ENV', 'development'),
  telegramBotToken: getEnv('TELEGRAM_BOT_TOKEN'),
  telegramChatId: getEnv('TELEGRAM_CHAT_ID'),
  mode: getEnv('MODE', 'paper') as EnvConfig['mode'],
  minLiquidityUsd: getEnvFloat('MIN_LIQUIDITY_USD', 5000),
  minVolume24hUsd: getEnvFloat('MIN_VOLUME_24H_USD', 10000),
  maxSpreadCents: getEnvFloat('MAX_SPREAD_CENTS', 8),
  maxExposureUsd: getEnvFloat('MAX_EXPOSURE_USD', 100),
  maxDrawdownPct: getEnvFloat('MAX_DRAWDOWN_PCT', 0.02),
  dailyReportHour: getEnvInt('DAILY_REPORT_HOUR', 20),
  dailyReportMinute: getEnvInt('DAILY_REPORT_MINUTE', 0),
};
