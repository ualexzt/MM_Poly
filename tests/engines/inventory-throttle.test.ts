import {
  computeInventoryThrottle,
  getInventoryThrottleProfile,
  InventoryThrottleProfile,
} from '../../src/engines/inventory-throttle';
import { defaultConfig } from '../../src/strategy/config';

const paperProfile: InventoryThrottleProfile = {
  reduceOnlyThresholdPct: 50,
  tiers: [
    { startPct: 25, sizeMultiplier: 0.5, extraHalfSpreadCents: 0.5 },
    { startPct: 35, sizeMultiplier: 0.25, extraHalfSpreadCents: 1.5 },
    { startPct: 45, sizeMultiplier: 0.05, extraHalfSpreadCents: 3.0, blockNewInventory: true },
  ],
};

const smallLiveProfile: InventoryThrottleProfile = {
  reduceOnlyThresholdPct: 35,
  tiers: [
    { startPct: 15, sizeMultiplier: 0.5, extraHalfSpreadCents: 0.75 },
    { startPct: 25, sizeMultiplier: 0.2, extraHalfSpreadCents: 2.0 },
    { startPct: 35, sizeMultiplier: 0.05, extraHalfSpreadCents: 4.0, blockNewInventory: true },
  ],
};

const profiles = {
  paper: paperProfile,
  small_live: smallLiveProfile,
};

describe('inventory-throttle', () => {
  test('default config exposes $30 guarded small_live sizing and throttle profile', () => {
    expect(defaultConfig.size.baseOrderSizeUsd).toBe(1);
    expect(defaultConfig.size.maxOrderSizeUsd).toBe(1.0);

    expect(defaultConfig.inventory.maxMarketExposureUsd).toBe(3);
    expect(defaultConfig.inventory.maxEventExposureUsd).toBe(10);
    expect(defaultConfig.inventory.maxTotalStrategyExposureUsd).toBe(25);
    expect(defaultConfig.inventory.softLimitPct).toBe(15);
    expect(defaultConfig.inventory.reduceOnlyLimitPct).toBe(35);
    expect(defaultConfig.inventory.hardLimitPct).toBe(50);

    expect(defaultConfig.inventory.throttleProfiles.paper.reduceOnlyThresholdPct).toBe(50);
    expect(defaultConfig.inventory.throttleProfiles.paper.tiers).toEqual([
      { startPct: 25, sizeMultiplier: 0.5, extraHalfSpreadCents: 0.5 },
      { startPct: 35, sizeMultiplier: 0.25, extraHalfSpreadCents: 1.5 },
      { startPct: 45, sizeMultiplier: 0.05, extraHalfSpreadCents: 3.0, blockNewInventory: true },
    ]);

    expect(defaultConfig.inventory.throttleProfiles.small_live.reduceOnlyThresholdPct).toBe(35);
    expect(defaultConfig.inventory.throttleProfiles.small_live.tiers).toEqual([
      { startPct: 15, sizeMultiplier: 0.5, extraHalfSpreadCents: 0.75 },
      { startPct: 25, sizeMultiplier: 0.2, extraHalfSpreadCents: 2.0 },
      { startPct: 35, sizeMultiplier: 0.05, extraHalfSpreadCents: 4.0, blockNewInventory: true },
    ]);
  });

  test('selects paper profile for paper and shadow modes', () => {
    expect(getInventoryThrottleProfile('paper', profiles)).toBe(paperProfile);
    expect(getInventoryThrottleProfile('shadow', profiles)).toBe(paperProfile);
  });

  test('selects small_live profile for small_live mode', () => {
    expect(getInventoryThrottleProfile('small_live', profiles)).toBe(smallLiveProfile);
  });

  test('returns no throttle below paper first tier', () => {
    const result = computeInventoryThrottle({
      mode: 'paper',
      profiles,
      netPosition: 10,
      inventoryUsagePct: 24.99,
      side: 'BUY',
    });

    expect(result.isInventoryIncreasing).toBe(true);
    expect(result.sizeMultiplier).toBe(1);
    expect(result.extraHalfSpreadCents).toBe(0);
    expect(result.blocked).toBe(false);
    expect(result.reduceOnly).toBe(false);
  });

  test('applies paper tiers at 25, 35, 45, and 50 percent', () => {
    expect(computeInventoryThrottle({ mode: 'paper', profiles, netPosition: 10, inventoryUsagePct: 25, side: 'BUY' })).toMatchObject({
      sizeMultiplier: 0.5,
      extraHalfSpreadCents: 0.5,
      blocked: false,
      reduceOnly: false,
    });
    expect(computeInventoryThrottle({ mode: 'paper', profiles, netPosition: 10, inventoryUsagePct: 35, side: 'BUY' })).toMatchObject({
      sizeMultiplier: 0.25,
      extraHalfSpreadCents: 1.5,
      blocked: false,
      reduceOnly: false,
    });
    expect(computeInventoryThrottle({ mode: 'paper', profiles, netPosition: 10, inventoryUsagePct: 45, side: 'BUY' })).toMatchObject({
      sizeMultiplier: 0.05,
      extraHalfSpreadCents: 3.0,
      blocked: true,
      reduceOnly: false,
    });
    expect(computeInventoryThrottle({ mode: 'paper', profiles, netPosition: 10, inventoryUsagePct: 50, side: 'BUY' })).toMatchObject({
      blocked: true,
      reduceOnly: true,
    });
  });

  test('applies stricter small_live tiers at 15, 25, and 35 percent', () => {
    expect(computeInventoryThrottle({ mode: 'small_live', profiles, netPosition: 10, inventoryUsagePct: 15, side: 'BUY' })).toMatchObject({
      sizeMultiplier: 0.5,
      extraHalfSpreadCents: 0.75,
      blocked: false,
      reduceOnly: false,
    });
    expect(computeInventoryThrottle({ mode: 'small_live', profiles, netPosition: 10, inventoryUsagePct: 25, side: 'BUY' })).toMatchObject({
      sizeMultiplier: 0.2,
      extraHalfSpreadCents: 2.0,
      blocked: false,
      reduceOnly: false,
    });
    expect(computeInventoryThrottle({ mode: 'small_live', profiles, netPosition: 10, inventoryUsagePct: 35, side: 'BUY' })).toMatchObject({
      sizeMultiplier: 0.05,
      extraHalfSpreadCents: 4.0,
      blocked: true,
      reduceOnly: true,
    });
  });

  test('LONG position throttles BUY but not SELL', () => {
    expect(computeInventoryThrottle({ mode: 'paper', profiles, netPosition: 10, inventoryUsagePct: 35, side: 'BUY' })).toMatchObject({
      isInventoryIncreasing: true,
      sizeMultiplier: 0.25,
    });
    expect(computeInventoryThrottle({ mode: 'paper', profiles, netPosition: 10, inventoryUsagePct: 35, side: 'SELL' })).toMatchObject({
      isInventoryIncreasing: false,
      sizeMultiplier: 1,
      extraHalfSpreadCents: 0,
      blocked: false,
      reduceOnly: false,
    });
  });

  test('SHORT position throttles SELL but not BUY', () => {
    expect(computeInventoryThrottle({ mode: 'paper', profiles, netPosition: -10, inventoryUsagePct: 35, side: 'SELL' })).toMatchObject({
      isInventoryIncreasing: true,
      sizeMultiplier: 0.25,
    });
    expect(computeInventoryThrottle({ mode: 'paper', profiles, netPosition: -10, inventoryUsagePct: 35, side: 'BUY' })).toMatchObject({
      isInventoryIncreasing: false,
      sizeMultiplier: 1,
      extraHalfSpreadCents: 0,
      blocked: false,
      reduceOnly: false,
    });
  });

  test('returns independent no-throttle result objects', () => {
    const first = computeInventoryThrottle({
      mode: 'paper',
      profiles,
      netPosition: 0,
      inventoryUsagePct: 50,
      side: 'BUY',
    });
    first.blocked = true;

    const second = computeInventoryThrottle({
      mode: 'paper',
      profiles,
      netPosition: 0,
      inventoryUsagePct: 50,
      side: 'SELL',
    });

    expect(second.blocked).toBe(false);
    expect(second).not.toBe(first);
  });

  test('FLAT position does not throttle either side', () => {
    expect(computeInventoryThrottle({ mode: 'paper', profiles, netPosition: 0, inventoryUsagePct: 50, side: 'BUY' })).toMatchObject({
      isInventoryIncreasing: false,
      sizeMultiplier: 1,
      extraHalfSpreadCents: 0,
      blocked: false,
      reduceOnly: false,
    });
    expect(computeInventoryThrottle({ mode: 'paper', profiles, netPosition: 0, inventoryUsagePct: 50, side: 'SELL' })).toMatchObject({
      isInventoryIncreasing: false,
      sizeMultiplier: 1,
      extraHalfSpreadCents: 0,
      blocked: false,
      reduceOnly: false,
    });
  });
});
