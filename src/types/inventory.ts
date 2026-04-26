export interface InventoryState {
  conditionId: string;
  pusdAvailable: number;
  yesTokens: number;
  noTokens: number;
  yesExposureUsd: number;
  noExposureUsd: number;
  netYesExposureUsd: number;
  marketExposureUsd: number;
  eventExposureUsd: number;
  strategyExposureUsd: number;
  inventoryPct: number;
  softLimitBreached: boolean;
  hardLimitBreached: boolean;
}
