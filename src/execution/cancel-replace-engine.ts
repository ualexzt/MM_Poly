import { PaperOrder, PaperExecutionEngine } from '../simulation/paper-execution-engine';

/**
 * Cancel-Replace Engine — §11.2
 *
 * Enforces cancel-before-replace to prevent double exposure.
 * Protocol:
 *   1. Mark old order as pending_cancel
 *   2. Send cancel
 *   3. Confirm cancel or timeout
 *   4. Only then submit replacement
 */

const CANCEL_CONFIRM_TIMEOUT_MS = 1500;

interface PendingCancel {
  orderId: string;
  cancelledAt: number;
  confirmed: boolean;
}

export class CancelReplaceEngine {
  private pendingCancels: Map<string, PendingCancel> = new Map();

  constructor(
    private engine: PaperExecutionEngine,
    private cancelConfirmTimeoutMs = CANCEL_CONFIRM_TIMEOUT_MS
  ) {}

  /**
   * Initiate cancel of an existing order.
   * Returns true if cancel was sent.
   */
  initCancel(orderId: string): boolean {
    if (this.pendingCancels.has(orderId)) return false; // already pending
    this.engine.cancel(orderId);
    this.pendingCancels.set(orderId, {
      orderId,
      cancelledAt: Date.now(),
      confirmed: true, // paper engine cancels synchronously
    });
    return true;
  }

  /**
   * Confirms whether a cancel has been processed (either confirmed or timed out).
   * In live mode this would await exchange confirmation; in paper it is immediate.
   */
  isCancelConfirmed(orderId: string): boolean {
    const pending = this.pendingCancels.get(orderId);
    if (!pending) return true; // not pending → treat as confirmed
    if (pending.confirmed) return true;
    // Timeout fallback (§11.2 cancel_confirm_timeout_ms)
    if (Date.now() - pending.cancelledAt >= this.cancelConfirmTimeoutMs) return true;
    return false;
  }

  clearCancel(orderId: string): void {
    this.pendingCancels.delete(orderId);
  }

  /**
   * Cancel then replace — only submits replacement after cancel confirmed.
   * Returns the new orderId if replacement was submitted, null if still waiting.
   */
  cancelAndReplace(
    oldOrderId: string | null,
    newOrder: PaperOrder
  ): string | null {
    // If there is an existing order, cancel it first
    if (oldOrderId) {
      // If we haven't initiated a cancel yet, do it now
      if (!this.hasPendingCancel(oldOrderId)) {
        this.initCancel(oldOrderId);
      }

      if (!this.isCancelConfirmed(oldOrderId)) {
        return null; // wait for confirmation
      }
      this.clearCancel(oldOrderId);
    }

    // Safe to submit replacement
    this.engine.submit(newOrder);
    return newOrder.id;
  }

  hasPendingCancel(orderId: string): boolean {
    return this.pendingCancels.has(orderId);
  }
}
