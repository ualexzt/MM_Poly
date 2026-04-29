import { estimateSlippage, estimateFillProbability } from '../../src/simulation/slippage-model';
import { BookState } from '../../src/types/book';

describe('slippage-model', () => {
  const book: BookState = {
    tokenId: 'yes1', conditionId: 'c1',
    bids: [{ price: 0.45, size: 100, sizeUsd: 45 }],
    asks: [{ price: 0.55, size: 100, sizeUsd: 55 }],
    bestBid: 0.45, bestAsk: 0.55,
    bestBidSizeUsd: 45, bestAskSizeUsd: 55,
    midpoint: 0.50, spread: 0.10, spreadTicks: 10,
    depth1Usd: 100, depth3Usd: 500,
    tickSize: 0.01, minOrderSize: 5,
    lastUpdateMs: Date.now()
  };

  test('estimateSlippage calculates adverse selection for BUY', () => {
    // We paid 0.48. But midpoint after 30s dropped to 0.45.
    // Adverse selection means we paid 0.48 for something worth 0.45.
    // Slippage = 0.48 - 0.45 = 0.03
    expect(estimateSlippage(0.48, 0.45, 'BUY')).toBeCloseTo(0.03, 4);

    // If midpoint moved to 0.50, it's favorable, so slippage = 0
    expect(estimateSlippage(0.48, 0.50, 'BUY')).toBe(0);
  });

  test('estimateSlippage calculates adverse selection for SELL', () => {
    // We sold at 0.52. Midpoint after 30s rose to 0.55.
    // Adverse selection means we sold for 0.52 something now worth 0.55.
    // Slippage = 0.55 - 0.52 = 0.03
    expect(estimateSlippage(0.52, 0.55, 'SELL')).toBeCloseTo(0.03, 4);

    // Favorable
    expect(estimateSlippage(0.52, 0.50, 'SELL')).toBe(0);
  });

  test('estimateFillProbability scales with size ahead', () => {
    // tradeSize = 10. levelDepthAhead = 45.
    // prob = 10 / (45 + 10) = 10/55 = 0.1818
    const prob = estimateFillProbability(0.45, 'BUY', book, 10);
    expect(prob).toBeCloseTo(0.1818, 4);

    // if queue is empty
    const bookEmpty: BookState = { ...book, bestBidSizeUsd: 0 };
    const probEmpty = estimateFillProbability(0.45, 'BUY', bookEmpty, 10);
    expect(probEmpty).toBe(1.0);
  });
});
