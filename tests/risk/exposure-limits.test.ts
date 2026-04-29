import { checkExposureLimits } from '../../src/risk/exposure-limits';
import { InventoryState } from '../../src/types/inventory';

describe('exposure-limits', () => {
  test('allows when within limits', () => {
    const state: InventoryState = {
      conditionId: 'c1', pusdAvailable: 100, yesTokens: 0, noTokens: 0,
      yesExposureUsd: 2, noExposureUsd: 2, netYesExposureUsd: 0,
      marketExposureUsd: 4, eventExposureUsd: 4, strategyExposureUsd: 4,
      inventoryPct: 0.04, softLimitBreached: false, hardLimitBreached: false
    };
    const result = checkExposureLimits(state, { maxMarketExposureUsd: 10, maxEventExposureUsd: 25, maxTotalStrategyExposureUsd: 100, softLimitPct: 0.35, hardLimitPct: 0.65 });
    expect(result.allowed).toBe(true);
  });

  test('blocks when hard limit breached', () => {
    const state: InventoryState = {
      conditionId: 'c1', pusdAvailable: 100, yesTokens: 0, noTokens: 0,
      yesExposureUsd: 50, noExposureUsd: 20, netYesExposureUsd: 30,
      marketExposureUsd: 70, eventExposureUsd: 70, strategyExposureUsd: 70,
      inventoryPct: 0.70, softLimitBreached: false, hardLimitBreached: true
    };
    const result = checkExposureLimits(state, { maxMarketExposureUsd: 10, maxEventExposureUsd: 25, maxTotalStrategyExposureUsd: 100, softLimitPct: 0.35, hardLimitPct: 0.65 });
    expect(result.allowed).toBe(false);
  });
});
