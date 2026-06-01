import { MicroGabagoolRiskManager, RiskManagerConfig } from '../../src/risk/micro-gabagool-risk-manager';

const defaultConfig: RiskManagerConfig = {
  maxDailyLossUsd: 1.50,
  maxTotalExposureUsd: 6.0,
  maxPositionPerMarketUsd: 3.0,
  maxActiveMarkets: 2,
  consecutiveLossLimit: 3,
  marketCooldownAfterLossMinutes: 30,
  marketCooldownAfterTwoBadExitsMinutes: 60,
};

describe('MicroGabagoolRiskManager', () => {
  it('should allow entry when all conditions pass', () => {
    const rm = new MicroGabagoolRiskManager(defaultConfig);
    expect(rm.canEnterMarket('m1', 1.5).allowed).toBe(true);
  });

  it('should block when daily loss exceeded', () => {
    const rm = new MicroGabagoolRiskManager(defaultConfig);
    rm.recordTrade({ marketId: 'm1', profitUsd: -1.6, timestamp: 0 });
    expect(rm.canEnterMarket('m1', 1.5).allowed).toBe(false);
    expect(rm.canEnterMarket('m1', 1.5).reason).toBe('kill_switch_daily_stop');
  });

  it('should block when total exposure exceeded', () => {
    const rm = new MicroGabagoolRiskManager(defaultConfig);
    rm.addExposure('m1', 3.0);
    rm.addExposure('m2', 3.0);
    expect(rm.canEnterMarket('m3', 1.5).allowed).toBe(false);
    expect(rm.canEnterMarket('m3', 1.5).reason).toBe('total_exposure_limit');
  });

  it('should allow same market even with max active', () => {
    const rm = new MicroGabagoolRiskManager(defaultConfig);
    rm.addExposure('m1', 1.0);
    rm.addExposure('m2', 1.0);
    expect(rm.canEnterMarket('m1', 1.0).allowed).toBe(true);
  });

  it('should block new market when max active reached', () => {
    const rm = new MicroGabagoolRiskManager(defaultConfig);
    rm.addExposure('m1', 1.0);
    rm.addExposure('m2', 1.0);
    expect(rm.canEnterMarket('m3', 1.5).allowed).toBe(false);
    expect(rm.canEnterMarket('m3', 1.5).reason).toBe('max_active_markets');
  });

  it('should block when market exposure exceeded', () => {
    const rm = new MicroGabagoolRiskManager(defaultConfig);
    rm.addExposure('m1', 2.0);
    expect(rm.canEnterMarket('m1', 1.5).allowed).toBe(false);
    expect(rm.canEnterMarket('m1', 1.5).reason).toBe('market_exposure_limit');
  });

  it('should track consecutive losses', () => {
    const rm = new MicroGabagoolRiskManager(defaultConfig);
    rm.recordTrade({ marketId: 'm1', profitUsd: -0.01, timestamp: 0 });
    rm.recordTrade({ marketId: 'm2', profitUsd: -0.01, timestamp: 0 });
    expect(rm.getConsecutiveLosses()).toBe(2);
    expect(rm.getKillSwitchState()).toBe('ACTIVE');

    rm.recordTrade({ marketId: 'm3', profitUsd: -0.01, timestamp: 0 });
    expect(rm.getConsecutiveLosses()).toBe(3);
    expect(rm.getKillSwitchState()).toBe('CONSECUTIVE_LOSS_FREEZE');
  });

  it('should reset consecutive losses on win', () => {
    const rm = new MicroGabagoolRiskManager(defaultConfig);
    rm.recordTrade({ marketId: 'm1', profitUsd: -0.01, timestamp: 0 });
    rm.recordTrade({ marketId: 'm2', profitUsd: 0.01, timestamp: 0 });
    expect(rm.getConsecutiveLosses()).toBe(0);
  });

  it('should cooldown market after loss', () => {
    const rm = new MicroGabagoolRiskManager(defaultConfig);
    const now = 1000000;
    rm.recordTrade({ marketId: 'm1', profitUsd: -0.01, timestamp: now }, now);

    expect(rm.canEnterMarket('m1', 1.5, now + 1000).allowed).toBe(false);
    expect(rm.canEnterMarket('m1', 1.5, now + 1000).reason).toBe('market_in_cooldown');

    expect(rm.canEnterMarket('m1', 1.5, now + 31 * 60_000).allowed).toBe(true);
  });

  it('should cooldown market after two bad exits', () => {
    const rm = new MicroGabagoolRiskManager(defaultConfig);
    const now = 1000000;
    rm.recordBadExit('m1', now);
    rm.recordBadExit('m1', now);

    expect(rm.canEnterMarket('m1', 1.5, now + 1000).allowed).toBe(false);
    expect(rm.canEnterMarket('m1', 1.5, now + 1000).reason).toBe('market_in_cooldown');

    expect(rm.canEnterMarket('m1', 1.5, now + 61 * 60_000).allowed).toBe(true);
  });

  it('should manual unlock from consecutive loss freeze', () => {
    const rm = new MicroGabagoolRiskManager(defaultConfig);
    rm.recordTrade({ marketId: 'm1', profitUsd: -0.01, timestamp: 0 });
    rm.recordTrade({ marketId: 'm2', profitUsd: -0.01, timestamp: 0 });
    rm.recordTrade({ marketId: 'm3', profitUsd: -0.01, timestamp: 0 });
    expect(rm.getKillSwitchState()).toBe('CONSECUTIVE_LOSS_FREEZE');

    rm.manualUnlock();
    expect(rm.getKillSwitchState()).toBe('ACTIVE');
    expect(rm.getConsecutiveLosses()).toBe(0);
  });

  it('should track exposure correctly', () => {
    const rm = new MicroGabagoolRiskManager(defaultConfig);
    rm.addExposure('m1', 1.5);
    rm.addExposure('m1', 1.0);
    expect(rm.getTotalExposure()).toBe(2.5);

    rm.removeExposure('m1', 1.5);
    expect(rm.getTotalExposure()).toBe(1.0);

    rm.removeExposure('m1', 1.0);
    expect(rm.getTotalExposure()).toBe(0);
  });

  it('should enter safe mode', () => {
    const rm = new MicroGabagoolRiskManager(defaultConfig);
    expect(rm.getKillSwitchState()).toBe('ACTIVE');

    rm.enterSafeMode();
    expect(rm.getKillSwitchState()).toBe('SAFE_MODE');
    expect(rm.canEnterMarket('m1', 1.5).allowed).toBe(false);
    expect(rm.canEnterMarket('m1', 1.5).reason).toBe('kill_switch_safe_mode');
  });

  it('should track daily PnL', () => {
    const rm = new MicroGabagoolRiskManager(defaultConfig);
    rm.recordTrade({ marketId: 'm1', profitUsd: 0.05, timestamp: 0 });
    rm.recordTrade({ marketId: 'm2', profitUsd: -0.02, timestamp: 0 });
    expect(rm.getDailyPnl()).toBeCloseTo(0.03, 2);
  });

  it('should track active markets count', () => {
    const rm = new MicroGabagoolRiskManager(defaultConfig);
    expect(rm.getActiveMarketsCount()).toBe(0);

    rm.addExposure('m1', 1.0);
    expect(rm.getActiveMarketsCount()).toBe(1);

    rm.addExposure('m2', 1.0);
    expect(rm.getActiveMarketsCount()).toBe(2);

    rm.removeExposure('m1', 1.0);
    expect(rm.getActiveMarketsCount()).toBe(1);
  });
});
