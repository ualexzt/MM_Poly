import type { EnvConfig } from '../config/env';
import { TelegramNotifier } from '../notifier/telegram';
import type { Logger } from '../utils/logger';
import {
  evaluateSmallLiveGoNoGo,
  type SmallLiveGoNoGoBlocker,
  type SmallLiveGoNoGoInput,
} from '../risk/small-live-go-no-go';

export type SmallLiveStartupBlocker =
  | 'missing_private_key'
  | 'invalid_private_key'
  | 'missing_clob_credentials'
  | 'missing_wallet_address'
  | 'mode_not_small_live'
  | 'live_trading_disabled'
  | 'max_markets_above_approved_limit'
  | 'max_exposure_above_approved_limit'
  | 'telegram_missing'
  | 'position_reconciliation_failed'
  | 'startup_cancel_failed'
  | `go_no_go:${SmallLiveGoNoGoBlocker}`;

export interface SmallLiveStartupValidation {
  ok: boolean;
  blockers: SmallLiveStartupBlocker[];
}

const PRIVATE_KEY_RE = /^0x[0-9a-fA-F]{64}$/;
const APPROVED_SMALL_LIVE_MAX_MARKETS = 2;
const APPROVED_SMALL_LIVE_MAX_EXPOSURE_USD = 10;

function hasText(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validateSmallLiveStartupEnv(envConfig: EnvConfig): SmallLiveStartupValidation {
  const blockers: SmallLiveStartupBlocker[] = [];

  if (envConfig.mode !== 'small_live') blockers.push('mode_not_small_live');
  if (!envConfig.liveTradingEnabled) blockers.push('live_trading_disabled');
  if (envConfig.maxMarkets > APPROVED_SMALL_LIVE_MAX_MARKETS) blockers.push('max_markets_above_approved_limit');
  if (envConfig.maxExposureUsd > APPROVED_SMALL_LIVE_MAX_EXPOSURE_USD) blockers.push('max_exposure_above_approved_limit');
  if (!hasText(envConfig.telegramBotToken) || !hasText(envConfig.telegramChatId)) blockers.push('telegram_missing');
  if (!hasText(envConfig.privateKey)) blockers.push('missing_private_key');
  else if (!PRIVATE_KEY_RE.test(envConfig.privateKey)) blockers.push('invalid_private_key');
  if (!hasText(envConfig.clobApiKey) || !hasText(envConfig.clobApiSecret) || !hasText(envConfig.clobApiPassphrase)) {
    blockers.push('missing_clob_credentials');
  }
  if (!hasText(envConfig.walletAddress)) blockers.push('missing_wallet_address');

  return { ok: blockers.length === 0, blockers };
}

export function buildGoNoGoStartupBlockers(input: SmallLiveGoNoGoInput): SmallLiveStartupBlocker[] {
  return evaluateSmallLiveGoNoGo(input).blockers.map((blocker) => `go_no_go:${blocker}` as const);
}

export function buildGoNoGoStartupBlockersFromEnv(envConfig: EnvConfig): SmallLiveStartupBlocker[] {
  return buildGoNoGoStartupBlockers({
    riskStatus: envConfig.smallLiveRiskStatus,
    reasons: envConfig.smallLiveRiskReasons,
    realizedPnlExRebatesUsd: envConfig.smallLiveRealizedPnlExRebatesUsd,
    worstTopInventoryExitPnlUsd: envConfig.smallLiveWorstTopInventoryExitPnlUsd,
    testsPassing: envConfig.smallLiveTestsPassing,
    buildPassing: envConfig.smallLiveBuildPassing,
  });
}

export async function notifyStartupBlockers(
  blockers: SmallLiveStartupBlocker[],
  envConfig: EnvConfig,
  logger: Pick<Logger, 'warn' | 'error'>
): Promise<void> {
  if (blockers.length === 0) return;

  if (!hasText(envConfig.telegramBotToken) || !hasText(envConfig.telegramChatId)) {
    logger.warn('Telegram credentials missing; startup blocker alert not sent');
    return;
  }

  const notifier = new TelegramNotifier({ botToken: envConfig.telegramBotToken, chatId: envConfig.telegramChatId });
  const text = [
    '<b>🚫 small_live startup blocked</b>',
    '',
    ...blockers.map((blocker) => `• ${blocker}`),
  ].join('\n');

  try {
    await notifier.sendMessage(text);
  } catch (err) {
    logger.error('Failed to send startup blocker Telegram alert', { error: String(err) });
  }
}
