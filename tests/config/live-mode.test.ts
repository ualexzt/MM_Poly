import { loadLiveModeConfig } from '../../src/config/live-mode';

describe('loadLiveModeConfig', () => {
  it('defaults to paper mode and disables live trading', () => {
    const cfg = loadLiveModeConfig({});

    expect(cfg.mode).toBe('paper');
    expect(cfg.liveEnabled).toBe(false);
    expect(cfg.canPlaceLiveOrders).toBe(false);
  });

  it('fails closed when small_live is set without explicit live enable flag', () => {
    const cfg = loadLiveModeConfig({ TRADING_MODE: 'small_live' });

    expect(cfg.mode).toBe('small_live');
    expect(cfg.liveEnabled).toBe(false);
    expect(cfg.canPlaceLiveOrders).toBe(false);
  });

  it('enables live orders only when both gates are set', () => {
    const cfg = loadLiveModeConfig({ TRADING_MODE: 'small_live', ENABLE_LIVE_TRADING: 'true' });

    expect(cfg.canPlaceLiveOrders).toBe(true);
  });

  it('uses strict $2 pilot limits in small live mode', () => {
    const cfg = loadLiveModeConfig({ TRADING_MODE: 'small_live', ENABLE_LIVE_TRADING: 'true' });

    expect(cfg.risk.maxExposureUsd).toBe(2);
    expect(cfg.risk.maxExposurePerMarketUsd).toBe(2);
    expect(cfg.risk.maxOpenOrders).toBe(1);
    expect(cfg.accumulator.tradeSize).toBe(1);
    expect(cfg.equalizer.tradeSize).toBe(1);
  });
});
