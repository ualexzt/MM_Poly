import { InventoryTracker } from '../../src/engines/inventory-tracker';
import { defaultConfig } from '../../src/strategy/config';

describe('InventoryTracker', () => {
  describe('loadPositions', () => {
    it('seeds inventory from external position data', () => {
      const tracker = new InventoryTracker(defaultConfig.inventory, 100);

      tracker.loadPositions([
        { tokenId: 'yes-token-1', size: 50, avgPrice: 0.45 },
        { tokenId: 'no-token-1', size: 20, avgPrice: 0.55 },
      ]);

      expect(tracker.getTokenBalance('yes-token-1')).toBe(50);
      expect(tracker.getTokenBalance('no-token-1')).toBe(20);
    });

    it('does not overwrite existing balances', () => {
      const tracker = new InventoryTracker(defaultConfig.inventory, 100);

      // First add via normal fill
      tracker.onFill('cond-1', 'yes-token-1', 'BUY', 0.40, 10);

      // Then load positions — should NOT overwrite the fill above
      tracker.loadPositions([
        { tokenId: 'yes-token-1', size: 50, avgPrice: 0.45 },
      ]);

      // loadPositions only seeds tokens that have NO existing balance
      expect(tracker.getTokenBalance('yes-token-1')).toBe(10); // unchanged from fill
    });

    it('handles empty array', () => {
      const tracker = new InventoryTracker(defaultConfig.inventory, 100);
      tracker.loadPositions([]);
      expect(tracker.getTokenBalance('any')).toBe(0);
    });

    it('skips zero-size positions', () => {
      const tracker = new InventoryTracker(defaultConfig.inventory, 100);
      tracker.loadPositions([
        { tokenId: 'empty-token', size: 0, avgPrice: 0.50 },
      ]);
      expect(tracker.getTokenBalance('empty-token')).toBe(0);
    });

    it('tracks total exposure after loading', () => {
      const tracker = new InventoryTracker(defaultConfig.inventory, 100);
      tracker.loadPositions([
        { tokenId: 'yes-token-1', size: 50, avgPrice: 0.45 },
        { tokenId: 'no-token-1', size: 20, avgPrice: 0.55 },
      ]);

      // 50*0.45 + 20*0.55 = 22.5 + 11 = 33.5
      expect(tracker.getTotalExposureUsd()).toBeCloseTo(33.5, 1);
    });
  });
});
