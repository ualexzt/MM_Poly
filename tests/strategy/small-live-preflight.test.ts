import type { EnvConfig } from '../../src/config/env';
import {
  buildGoNoGoStartupBlockers,
  buildGoNoGoStartupBlockersFromEnv,
  notifyStartupBlockers,
  validateSmallLiveStartupEnv,
} from '../../src/strategy/small-live-preflight';

const baseEnv: EnvConfig = {
  nodeEnv: 'test',
  telegramBotToken: 'telegram-token',
  telegramChatId: 'telegram-chat',
  mode: 'small_live',
  minLiquidityUsd: 5000,
  minVolume24hUsd: 10000,
  maxSpreadCents: 8,
  maxExposureUsd: 10,
  maxDrawdownPct: 0.02,
  dailyReportHour: 20,
  dailyReportMinute: 0,
  telegramReportIntervalHours: 3,
  maxMarkets: 2,
  liveTradingEnabled: true,
  privateKey: `0x${'a'.repeat(64)}`,
  clobApiKey: 'clob-key',
  clobApiSecret: 'clob-secret',
  clobApiPassphrase: 'clob-passphrase',
  walletAddress: '0xabc',
  smallLiveRiskStatus: 'OK',
  smallLiveRiskReasons: [],
  smallLiveRealizedPnlExRebatesUsd: 1,
  smallLiveWorstTopInventoryExitPnlUsd: -0.1,
  smallLiveTestsPassing: true,
  smallLiveBuildPassing: true,
};

const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  trace: jest.fn(),
};

describe('small-live startup preflight', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue({ json: async () => ({ ok: true }) }) as any;
  });

  test('blocks startup when WALLET_ADDRESS is missing', () => {
    const result = validateSmallLiveStartupEnv({ ...baseEnv, walletAddress: undefined });

    expect(result.ok).toBe(false);
    expect(result.blockers).toContain('missing_wallet_address');
  });

  test('blocks startup when private key format is invalid', () => {
    const result = validateSmallLiveStartupEnv({ ...baseEnv, privateKey: '0xnot-hex' });

    expect(result.ok).toBe(false);
    expect(result.blockers).toContain('invalid_private_key');
  });

  test('blocks small_live when maxMarkets exceeds approved envelope', () => {
    const result = validateSmallLiveStartupEnv({ ...baseEnv, maxMarkets: 3 });

    expect(result.ok).toBe(false);
    expect(result.blockers).toContain('max_markets_above_approved_limit');
  });

  test('blocks small_live when maxExposureUsd exceeds approved envelope', () => {
    const result = validateSmallLiveStartupEnv({ ...baseEnv, maxExposureUsd: 11 });

    expect(result.ok).toBe(false);
    expect(result.blockers).toContain('max_exposure_above_approved_limit');
  });

  test('blocks small_live when Telegram credentials are missing', () => {
    const result = validateSmallLiveStartupEnv({ ...baseEnv, telegramBotToken: '', telegramChatId: '' });

    expect(result.ok).toBe(false);
    expect(result.blockers).toContain('telegram_missing');
  });

  test('sends Telegram alert when blockers exist and Telegram credentials are configured', async () => {
    await notifyStartupBlockers(['missing_wallet_address', 'startup_cancel_failed'], baseEnv, logger);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, request] = (global.fetch as jest.Mock).mock.calls[0];
    const body = request.body as URLSearchParams;
    expect(body.get('text')).toContain('small_live startup blocked');
    expect(body.get('text')).toContain('missing_wallet_address');
    expect(body.get('text')).toContain('startup_cancel_failed');
  });

  test('skips Telegram alert when Telegram credentials are missing', async () => {
    await notifyStartupBlockers(['missing_wallet_address'], { ...baseEnv, telegramBotToken: '', telegramChatId: '' }, logger);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('Telegram credentials missing; startup blocker alert not sent');
  });

  test('converts go/no-go failures into startup blockers', () => {
    const blockers = buildGoNoGoStartupBlockers({
      riskStatus: 'OK',
      reasons: [],
      realizedPnlExRebatesUsd: 0,
      worstTopInventoryExitPnlUsd: null,
      testsPassing: true,
      buildPassing: true,
    });

    expect(blockers).toEqual(['go_no_go:realized_pnl_ex_rebates_not_positive']);
  });

  test('converts configured go/no-go env fields into startup blockers', () => {
    const blockers = buildGoNoGoStartupBlockersFromEnv({
      ...baseEnv,
      smallLiveRealizedPnlExRebatesUsd: 0,
      smallLiveTestsPassing: false,
    });

    expect(blockers).toEqual([
      'go_no_go:realized_pnl_ex_rebates_not_positive',
      'go_no_go:tests_not_passing',
    ]);
  });

  test('returns no go/no-go blockers when configured paper-soak inputs pass', () => {
    expect(buildGoNoGoStartupBlockersFromEnv(baseEnv)).toEqual([]);
  });
});
