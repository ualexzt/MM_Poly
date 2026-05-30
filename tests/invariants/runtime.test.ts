import { readFileSync } from 'fs';
import { defaultConfig } from '../../src/strategy/config';

const ORIGINAL_ENV = process.env;

describe('runtime invariants', () => {
  test('paper mode does not allow live orders', () => {
    expect(defaultConfig.mode).toBe('paper');
    expect(defaultConfig.liveTradingEnabled).toBe(false);
  });

  test('every config spread config is positive', () => {
    expect(defaultConfig.spread.baseHalfSpreadCents).toBeGreaterThan(0);
    expect(defaultConfig.spread.minHalfSpreadTicks).toBeGreaterThan(0);
  });

  test('inventory hard limit > soft limit', () => {
    expect(defaultConfig.inventory.hardLimitPct).toBeGreaterThan(defaultConfig.inventory.softLimitPct);
  });

  test('max quote lifetime >= min quote lifetime', () => {
    expect(defaultConfig.maxQuoteLifetimeMs).toBeGreaterThanOrEqual(defaultConfig.minQuoteLifetimeMs);
  });

  test('$30 guarded defaults are safe', () => {
    expect(defaultConfig.inventory.maxTotalStrategyExposureUsd).toBeLessThanOrEqual(25);
    expect(defaultConfig.inventory.maxMarketExposureUsd).toBeLessThanOrEqual(3);
    expect(defaultConfig.size.baseOrderSizeUsd).toBeLessThanOrEqual(1);
    expect(defaultConfig.size.maxOrderSizeUsd).toBeLessThanOrEqual(1.5);
    expect(defaultConfig.risk.maxDailyDrawdownUsd).toBeLessThanOrEqual(5);
  });

  test('env example documents wallet address once', () => {
    const envExample = readFileSync('.env.example', 'utf8');

    expect(envExample.match(/^WALLET_ADDRESS=/gm)).toHaveLength(1);
  });

  test('live trading env flag defaults off and must be explicitly enabled', () => {
    const loadEnv = (value?: string) => {
      jest.resetModules();
      process.env = {
        ...ORIGINAL_ENV,
        TELEGRAM_BOT_TOKEN: 'test-token',
        TELEGRAM_CHAT_ID: 'test-chat',
        LIVE_TRADING_ENABLED: value,
      };
      return require('../../src/config/env').env;
    };

    expect(loadEnv(undefined).liveTradingEnabled).toBe(false);
    expect(loadEnv('false').liveTradingEnabled).toBe(false);
    expect(loadEnv('true').liveTradingEnabled).toBe(true);

    process.env = ORIGINAL_ENV;
  });
});
