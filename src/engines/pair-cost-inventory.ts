import {
  InventoryLot,
  PairedLot,
  PairCostInventoryState,
  PairCostState,
} from './pair-cost-types';

interface RebuildPairCostInventoryInput {
  marketId: string;
  lots: InventoryLot[];
  maxPairCost: number;
  forcedState?: PairCostState;
}

const ROUND_FACTOR = 1_000_000_000;

function round(value: number): number {
  return Math.round(value * ROUND_FACTOR) / ROUND_FACTOR;
}

function copyLot(lot: InventoryLot, remainingQty = lot.remainingQty): InventoryLot {
  return {
    ...lot,
    remainingQty: round(remainingQty),
    cost: round(remainingQty * lot.price),
  };
}

function sortLots(lots: InventoryLot[]): InventoryLot[] {
  return lots
    .filter(lot => lot.remainingQty > 0)
    .map(lot => copyLot(lot))
    .sort((a, b) => {
      if (a.price !== b.price) return a.price - b.price;
      return a.timestamp.getTime() - b.timestamp.getTime();
    });
}

function deriveState(
  profitablePairs: PairedLot[],
  unpairedYesQty: number,
  unpairedNoQty: number,
  forcedState?: PairCostState,
): PairCostState {
  if (forcedState) return forcedState;
  if (unpairedYesQty > 0) return PairCostState.HAS_UNPAIRED_YES;
  if (unpairedNoQty > 0) return PairCostState.HAS_UNPAIRED_NO;
  if (profitablePairs.length > 0) return PairCostState.LOCKED_PAIR;
  return PairCostState.IDLE;
}

export function rebuildPairCostInventoryState(input: RebuildPairCostInventoryInput): PairCostInventoryState {
  const yesLots = sortLots(input.lots.filter(lot => lot.marketId === input.marketId && lot.side === 'YES'));
  const noLots = sortLots(input.lots.filter(lot => lot.marketId === input.marketId && lot.side === 'NO'));
  const yesRemaining = yesLots.map(lot => copyLot(lot));
  const noRemaining = noLots.map(lot => copyLot(lot));
  const profitablePairs: PairedLot[] = [];

  let yesIndex = 0;
  let noIndex = 0;

  while (yesIndex < yesRemaining.length && noIndex < noRemaining.length) {
    const yesLot = yesRemaining[yesIndex];
    const noLot = noRemaining[noIndex];
    const pairCost = round(yesLot.price + noLot.price);

    if (pairCost > input.maxPairCost) break;

    const qty = round(Math.min(yesLot.remainingQty, noLot.remainingQty));
    const edgePerPair = round(1 - pairCost);
    const lockedProfit = round(qty * edgePerPair);

    profitablePairs.push({
      marketId: input.marketId,
      qty,
      yesLotId: yesLot.id,
      noLotId: noLot.id,
      yesPrice: yesLot.price,
      noPrice: noLot.price,
      pairCost,
      edgePerPair,
      lockedProfit,
    });

    yesLot.remainingQty = round(yesLot.remainingQty - qty);
    yesLot.cost = round(yesLot.remainingQty * yesLot.price);
    noLot.remainingQty = round(noLot.remainingQty - qty);
    noLot.cost = round(noLot.remainingQty * noLot.price);

    if (yesLot.remainingQty === 0) yesIndex += 1;
    if (noLot.remainingQty === 0) noIndex += 1;
  }

  const unpairedYesLots = yesRemaining.filter(lot => lot.remainingQty > 0).map(lot => copyLot(lot));
  const unpairedNoLots = noRemaining.filter(lot => lot.remainingQty > 0).map(lot => copyLot(lot));
  const pairedQty = round(profitablePairs.reduce((sum, pair) => sum + pair.qty, 0));
  const unpairedYesQty = round(unpairedYesLots.reduce((sum, lot) => sum + lot.remainingQty, 0));
  const unpairedNoQty = round(unpairedNoLots.reduce((sum, lot) => sum + lot.remainingQty, 0));
  const lockedProfit = round(profitablePairs.reduce((sum, pair) => sum + pair.lockedProfit, 0));

  return {
    marketId: input.marketId,
    yesLots,
    noLots,
    profitablePairs,
    unpairedYesLots,
    unpairedNoLots,
    pairedQty,
    unpairedYesQty,
    unpairedNoQty,
    lockedProfit,
    state: deriveState(profitablePairs, unpairedYesQty, unpairedNoQty, input.forcedState),
  };
}

export function averageCostOfLots(lots: InventoryLot[], qty: number): number {
  if (qty <= 0) return 0;

  const sorted = sortLots(lots);
  let remaining = qty;
  let totalCost = 0;
  let selectedQty = 0;

  for (const lot of sorted) {
    if (remaining <= 0) break;
    const takeQty = Math.min(lot.remainingQty, remaining);
    totalCost += takeQty * lot.price;
    selectedQty += takeQty;
    remaining -= takeQty;
  }

  if (selectedQty < qty) {
    throw new Error(`not enough lot quantity: requested ${qty}, available ${selectedQty}`);
  }

  return round(totalCost / qty);
}
