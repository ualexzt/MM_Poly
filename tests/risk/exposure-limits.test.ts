import { checkExposureLimits } from '../../src/risk/exposure-limits';
import { InventoryState } from '../../src/types/inventory';

describe('exposure-limits', () => {
  test('allows when within limits', () => {
    const state: InventoryState = {
      conditionId: 'c1', pusdAvailable: 1000, yesTokens: 0, noTokens: 0,
      yesExposureUsd: 10, noExposureUsd: 10, netYesExposureUsd: 0,
      marketExposureUsd: 20, eventExposureUsd: 20, strategyExposureUsd: 20,
      inventoryPct: 0.02, softLimitBreached: false, hardLimitBreached: false
    };
    const result = checkExposureLimits(state, { maxMarketExposureUsd: 100, maxEventExposureUsd: 250, maxTotalStrategyExposureUsd: 1000, softLimitPct: 0.35, hardLimitPct: 0.65 });
    expect(result.allowed).toBe(true);
  });

  test('blocks when hard limit breached', () => {
    const state: InventoryState = {
      conditionId: 'c1', pusdAvailable: 1000, yesTokens: 0, noTokens: 0,
      yesExposureUsd: 500, noExposureUsd: 200, netYesExposureUsd: 300,
      marketExposureUsd: 700, eventExposureUsd: 700, strategyExposureUsd: 700,
      inventoryPct: 0.70, softLimitBreached: false, hardLimitBreached: true
    };
    const result = checkExposureLimits(state, { maxMarketExposureUsd: 100, maxEventExposureUsd: 250, maxTotalStrategyExposureUsd: 1000, softLimitPct: 0.35, hardLimitPct: 0.65 });
    expect(result.allowed).toBe(false);
  });
});
