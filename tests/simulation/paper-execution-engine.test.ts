import { PaperExecutionEngine } from '../../src/simulation/paper-execution-engine';

describe('paper-execution-engine', () => {
  test('passive buy fills only after trade at or below price', () => {
    const engine = new PaperExecutionEngine();
    engine.submit({ id: 'o1', tokenId: 'yes1', side: 'BUY', price: 0.48, size: 10, sizeUsd: 4.8, postOnly: true });
    const fillsBefore = engine.onTrade({ tokenId: 'yes1', price: 0.49, size: 5 });
    expect(fillsBefore).toHaveLength(0);
    const fillsAfter = engine.onTrade({ tokenId: 'yes1', price: 0.48, size: 5 });
    expect(fillsAfter).toHaveLength(1);
    expect(fillsAfter[0].filledSize).toBe(5);
  });

  test('passive sell fills only after trade at or above price', () => {
    const engine = new PaperExecutionEngine();
    engine.submit({ id: 'o2', tokenId: 'yes1', side: 'SELL', price: 0.52, size: 10, sizeUsd: 5.2, postOnly: true });
    const fillsBefore = engine.onTrade({ tokenId: 'yes1', price: 0.51, size: 5 });
    expect(fillsBefore).toHaveLength(0);
    const fillsAfter = engine.onTrade({ tokenId: 'yes1', price: 0.52, size: 5 });
    expect(fillsAfter).toHaveLength(1);
  });

  test('supports partial fills', () => {
    const engine = new PaperExecutionEngine();
    engine.submit({ id: 'o3', tokenId: 'yes1', side: 'BUY', price: 0.48, size: 10, sizeUsd: 4.8, postOnly: true });
    const fills = engine.onTrade({ tokenId: 'yes1', price: 0.47, size: 3 });
    expect(fills).toHaveLength(1);
    expect(fills[0].filledSize).toBe(3);
    expect(fills[0].remainingSize).toBe(7);
  });

  test('cancel removes order', () => {
    const engine = new PaperExecutionEngine();
    engine.submit({ id: 'o4', tokenId: 'yes1', side: 'BUY', price: 0.48, size: 10, sizeUsd: 4.8, postOnly: true });
    engine.cancel('o4');
    const fills = engine.onTrade({ tokenId: 'yes1', price: 0.47, size: 10 });
    expect(fills).toHaveLength(0);
  });
});
