import { InventoryState } from '../types/inventory';
import { Side } from '../types/quote';

export type InventoryAction = 'below_soft_limit' | 'above_soft_limit' | 'above_hard_limit';

export function computeInventorySkew(inventoryPct: number, maxSkewCents: number, sensitivity: number): number {
  return maxSkewCents * Math.tanh(inventoryPct / sensitivity);
}

export function getInventoryAction(state: InventoryState): InventoryAction {
  if (state.hardLimitBreached) return 'above_hard_limit';
  if (state.softLimitBreached) return 'above_soft_limit';
  return 'below_soft_limit';
}

export function checkSellInventoryAvailable(side: Side, orderSize: number, tokenInventory: number): boolean {
  if (side === 'BUY') return true;
  return tokenInventory >= orderSize;
}
