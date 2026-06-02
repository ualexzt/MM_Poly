import {
  InventoryLot,
  PairCostState,
} from '../../src/engines/pair-cost-types';
import {
  averageCostOfLots,
  rebuildPairCostInventoryState,
} from '../../src/engines/pair-cost-inventory';

function lot(overrides: Partial<InventoryLot>): InventoryLot {
  return {
    id: overrides.id ?? 'lot-1',
    marketId: overrides.marketId ?? 'market-1',
    side: overrides.side ?? 'YES',
    qty: overrides.qty ?? 1,
    remainingQty: overrides.remainingQty ?? overrides.qty ?? 1,
    price: overrides.price ?? 0.5,
    cost: overrides.cost ?? (overrides.remainingQty ?? overrides.qty ?? 1) * (overrides.price ?? 0.5),
    timestamp: overrides.timestamp ?? new Date('2026-01-01T00:00:00.000Z'),
    sourceOrderId: overrides.sourceOrderId ?? null,
  };
}

describe('rebuildPairCostInventoryState', () => {
  it('pairs cheapest YES and NO lots at lot level and leaves expensive YES unpaired', () => {
    const state = rebuildPairCostInventoryState({
      marketId: 'market-1',
      lots: [
        lot({ id: 'yes-cheap', side: 'YES', qty: 5, remainingQty: 5, price: 0.42 }),
        lot({ id: 'yes-expensive', side: 'YES', qty: 5, remainingQty: 5, price: 0.60 }),
        lot({ id: 'no-lot', side: 'NO', qty: 5, remainingQty: 5, price: 0.45 }),
      ],
      maxPairCost: 0.985,
    });

    expect(state.profitablePairs).toHaveLength(1);
    expect(state.profitablePairs[0]).toEqual(expect.objectContaining({
      qty: 5,
      yesLotId: 'yes-cheap',
      noLotId: 'no-lot',
      yesPrice: 0.42,
      noPrice: 0.45,
      pairCost: 0.87,
      edgePerPair: 0.13,
      lockedProfit: 0.65,
    }));
    expect(state.pairedQty).toBe(5);
    expect(state.unpairedYesQty).toBe(5);
    expect(state.unpairedYesLots).toHaveLength(1);
    expect(state.unpairedYesLots[0]).toEqual(expect.objectContaining({
      id: 'yes-expensive',
      price: 0.60,
      remainingQty: 5,
    }));
    expect(state.unpairedNoQty).toBe(0);
    expect(state.lockedProfit).toBeCloseTo(0.65);
    expect(state.state).toBe(PairCostState.HAS_UNPAIRED_YES);
  });

  it('does not hide unpaired expensive inventory behind side-average cost', () => {
    const state = rebuildPairCostInventoryState({
      marketId: 'market-1',
      lots: [
        lot({ id: 'yes-cheap', side: 'YES', qty: 5, remainingQty: 5, price: 0.42 }),
        lot({ id: 'yes-expensive', side: 'YES', qty: 5, remainingQty: 5, price: 0.60 }),
        lot({ id: 'no-lot', side: 'NO', qty: 5, remainingQty: 5, price: 0.45 }),
      ],
      maxPairCost: 0.985,
    });

    expect(state.profitablePairs.reduce((sum, pair) => sum + pair.qty, 0)).toBe(5);
    expect(state.unpairedYesQty).toBe(5);
    expect(state.unpairedYesLots.map(l => l.id)).toEqual(['yes-expensive']);
  });

  it('uses selected unpaired lots, not whole-side average, for hedge cost', () => {
    const lots = [
      lot({ id: 'yes-cheap', side: 'YES', qty: 5, remainingQty: 5, price: 0.42 }),
      lot({ id: 'yes-expensive', side: 'YES', qty: 5, remainingQty: 5, price: 0.60 }),
    ];

    expect(averageCostOfLots(lots, 5)).toBeCloseTo(0.42);
    expect(averageCostOfLots(lots, 10)).toBeCloseTo(0.51);
  });
});
