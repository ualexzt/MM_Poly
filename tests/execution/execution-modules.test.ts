import { checkPostOnly, validateOrderPreSubmit } from '../../src/execution/post-only-guard';
import { CancelReplaceEngine } from '../../src/execution/cancel-replace-engine';
import { OpenOrderReconciler } from '../../src/execution/open-order-reconciler';
import { PaperExecutionEngine } from '../../src/simulation/paper-execution-engine';
import { QuoteCandidate } from '../../src/types/quote';
import { BookState } from '../../src/types/book';

describe('execution tests', () => {
  describe('post-only-guard', () => {
    const book: BookState = {
      tokenId: 'yes1', conditionId: 'c1',
      bids: [], asks: [],
      bestBid: 0.45, bestAsk: 0.55,
      bestBidSizeUsd: 100, bestAskSizeUsd: 100,
      midpoint: 0.50, spread: 0.10, spreadTicks: 10,
      depth1Usd: 100, depth3Usd: 500,
      tickSize: 0.01, minOrderSize: 5,
      lastUpdateMs: Date.now()
    };

    test('accepts safe BUY quote', () => {
      const quote: QuoteCandidate = {
        conditionId: 'c1', tokenId: 'yes1', side: 'BUY', price: 0.45, size: 10, sizeUsd: 4.5,
        postOnly: true, orderType: 'GTC', fairPrice: 0.50, targetHalfSpreadCents: 5,
        inventorySkewCents: 0, toxicityScore: 0, reason: 'test', riskFlags: []
      };
      const result = checkPostOnly(quote, book);
      expect(result.safe).toBe(true);
      expect(result.adjustedPrice).toBeUndefined();
    });

    test('adjusts unsafe BUY quote to one tick below ask', () => {
      const quote: QuoteCandidate = {
        conditionId: 'c1', tokenId: 'yes1', side: 'BUY', price: 0.55, size: 10, sizeUsd: 5.5,
        postOnly: true, orderType: 'GTC', fairPrice: 0.50, targetHalfSpreadCents: 5,
        inventorySkewCents: 0, toxicityScore: 0, reason: 'test', riskFlags: []
      };
      const result = checkPostOnly(quote, book);
      expect(result.safe).toBe(true);
      expect(result.adjustedPrice).toBe(0.54);
    });

    test('adjusts unsafe SELL quote to one tick above bid', () => {
      const quote: QuoteCandidate = {
        conditionId: 'c1', tokenId: 'yes1', side: 'SELL', price: 0.45, size: 10, sizeUsd: 4.5,
        postOnly: true, orderType: 'GTC', fairPrice: 0.50, targetHalfSpreadCents: 5,
        inventorySkewCents: 0, toxicityScore: 0, reason: 'test', riskFlags: []
      };
      const result = checkPostOnly(quote, book);
      expect(result.safe).toBe(true);
      expect(result.adjustedPrice).toBe(0.46);
    });
  });

  describe('cancel-replace-engine', () => {
    test('enforces cancel before replace', () => {
      const paperEngine = new PaperExecutionEngine();
      const cancelReplace = new CancelReplaceEngine(paperEngine, 1500);

      const oldId = 'order-1';
      paperEngine.submit({ id: oldId, tokenId: 'yes1', side: 'BUY', price: 0.45, size: 10, sizeUsd: 4.5, postOnly: true });

      const newId = cancelReplace.cancelAndReplace(oldId, {
        id: 'order-2', tokenId: 'yes1', side: 'BUY', price: 0.46, size: 10, sizeUsd: 4.6, postOnly: true
      });

      // Since paper engine is synchronous, it should immediately return newId
      expect(newId).toBe('order-2');
      expect(paperEngine.getOpenOrders().length).toBe(1);
      expect(paperEngine.getOpenOrders()[0].id).toBe('order-2');
    });
  });

  describe('open-order-reconciler', () => {
    test('identifies toCancel and toSubmit', () => {
      const paperEngine = new PaperExecutionEngine();
      paperEngine.submit({ id: 'o1', tokenId: 'yes1', side: 'BUY', price: 0.45, size: 10, sizeUsd: 4.5, postOnly: true });
      paperEngine.submit({ id: 'o2', tokenId: 'yes1', side: 'SELL', price: 0.60, size: 10, sizeUsd: 6.0, postOnly: true });

      const reconciler = new OpenOrderReconciler(paperEngine);

      const targets = [
        { tokenId: 'yes1', side: 'BUY' as const, price: 0.45, size: 10, sizeUsd: 4.5 }, // unchanged
        { tokenId: 'yes1', side: 'SELL' as const, price: 0.55, size: 10, sizeUsd: 5.5 }  // price improved
      ];

      const result = reconciler.reconcile(targets, 60000);

      expect(result.unchanged).toContain('o1');
      expect(result.toCancel).toContain('o2');
      expect(result.toSubmit.length).toBe(1);
      expect(result.toSubmit[0].price).toBe(0.55);
    });
  });
});
