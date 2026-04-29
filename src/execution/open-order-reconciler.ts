import { PaperOrder, PaperExecutionEngine } from '../simulation/paper-execution-engine';

/**
 * Open Order Reconciler — §11.1 step 12-13
 *
 * Diffs target quotes vs open orders.
 * Identifies orders to cancel (stale, wrong price/side) and orders to submit.
 */

export interface TargetQuote {
  tokenId: string;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  sizeUsd: number;
}

export interface ReconcileResult {
  toCancel: string[];          // orderIds to cancel
  toSubmit: TargetQuote[];     // new quotes to submit
  unchanged: string[];         // orderIds that are fine as-is
}

const PRICE_EPSILON = 0.005;
const SIZE_EPSILON = 0.01;

/**
 * Checks if an existing order matches the target quote closely enough.
 */
function ordersMatch(order: PaperOrder, target: TargetQuote): boolean {
  if (order.side !== target.side) return false;
  if (order.tokenId !== target.tokenId) return false;
  if (Math.abs(order.price - target.price) > PRICE_EPSILON) return false;
  if (Math.abs(order.size - target.size) > SIZE_EPSILON) return false;
  return true;
}

export class OpenOrderReconciler {
  constructor(private engine: PaperExecutionEngine) {}

  /**
   * Reconcile current open orders vs desired target quotes.
   * Returns what needs to be cancelled and what needs to be submitted.
   */
  reconcile(
    targetQuotes: TargetQuote[],
    staleOrderMaxAgeMs: number
  ): ReconcileResult {
    const openOrders = this.engine.getOpenOrders();
    const now = Date.now();

    const toCancel: string[] = [];
    const toSubmit: TargetQuote[] = [];
    const unchanged: string[] = [];
    const matchedTargets = new Set<number>(); // indices into targetQuotes

    // For each open order, check if it matches a target
    for (const order of openOrders) {
      // Check staleness via order age (orders have no timestamp in PaperOrder,
      // so stale check is handled by the runner — here we just match targets)
      let matched = false;
      for (let i = 0; i < targetQuotes.length; i++) {
        if (matchedTargets.has(i)) continue;
        if (ordersMatch(order, targetQuotes[i])) {
          matchedTargets.add(i);
          unchanged.push(order.id);
          matched = true;
          break;
        }
      }
      if (!matched) {
        toCancel.push(order.id);
      }
    }

    // Any targets not matched by existing orders need to be submitted
    for (let i = 0; i < targetQuotes.length; i++) {
      if (!matchedTargets.has(i)) {
        toSubmit.push(targetQuotes[i]);
      }
    }

    return { toCancel, toSubmit, unchanged };
  }
}
