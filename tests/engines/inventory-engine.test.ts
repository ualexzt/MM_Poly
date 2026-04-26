import { computeInventorySkew, getInventoryAction, checkSellInventoryAvailable } from '../../src/engines/inventory-engine';
import { InventoryState } from '../../src/types/inventory';

describe('inventory-engine', () => {
  function makeState(overrides: Partial<InventoryState> = {}): InventoryState {
    return {
      conditionId: 'test',
      pusdAvailable: 1000,
      yesTokens: 10,
      noTokens: 10,
      yesExposureUsd: 50,
      noExposureUsd: 50,
      netYesExposureUsd: 0,
      marketExposureUsd: 100,
      eventExposureUsd: 100,
      strategyExposureUsd: 100,
      inventoryPct: 0,
      softLimitBreached: false,
      hardLimitBreached: false,
      ...overrides
    };
  }

  test('computes zero skew at neutral inventory', () => {
    expect(computeInventorySkew(0, 3.0, 0.35)).toBeCloseTo(0, 1);
  });

  test('skews quotes against positive inventory', () => {
    const skew = computeInventorySkew(0.5, 3.0, 0.35);
    expect(skew).toBeGreaterThan(0);
    expect(skew).toBeLessThanOrEqual(3.0);
  });

  test('detects soft limit', () => {
    const state = makeState({ inventoryPct: 0.40, softLimitBreached: true });
    expect(getInventoryAction(state)).toBe('above_soft_limit');
  });

  test('detects hard limit', () => {
    const state = makeState({ inventoryPct: 0.70, hardLimitBreached: true });
    expect(getInventoryAction(state)).toBe('above_hard_limit');
  });

  test('blocks sell order without inventory', () => {
    expect(checkSellInventoryAvailable('SELL', 5, 3)).toBe(false);
    expect(checkSellInventoryAvailable('SELL', 5, 10)).toBe(true);
    expect(checkSellInventoryAvailable('BUY', 5, 0)).toBe(true);
  });
});
