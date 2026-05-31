import { PaperExecutionEngine } from '../simulation/paper-execution-engine';
import { LiveOrderSubmitter } from './live-order-submitter';
import { QuoteCandidate } from '../types/quote';
import { BookState } from '../types/book';
import { checkPostOnly, validateOrderPreSubmit } from './post-only-guard';
import { CancelReplaceEngine } from './cancel-replace-engine';

export interface OrderRouterConfig {
  mode: 'paper' | 'shadow' | 'small_live' | 'disabled';
  liveTradingEnabled: boolean;
}

export interface RouteResult {
  submitted: boolean;
  orderId?: string;
  reason: string;
  cancelledExistingOrderId?: string;
  filledSize?: number;
  filledPrice?: number;
}

/**
 * Order Router — §12
 * Routes validated quotes to paper/shadow/live execution.
 * Enforces the full pre-submit checklist (§12.2) before every order.
 */
export class OrderRouter {
  private cancelReplace: CancelReplaceEngine;

  constructor(
    private engine: PaperExecutionEngine,
    private config: OrderRouterConfig,
    private liveSubmitter: LiveOrderSubmitter | null = null
  ) {
    this.cancelReplace = new CancelReplaceEngine(engine);
  }

  /**
   * Route a validated quote candidate.
   * @param existingOrderId - orderId to cancel-replace (null = new order)
   */
  async route(
    quote: QuoteCandidate,
    book: BookState,
    existingOrderId: string | null,
    opts: {
      exposureAllowed: boolean;
      sellInventoryAvailable: boolean;
      killSwitchActive: boolean;
    }
  ): Promise<RouteResult> {
    // §12.2 pre-submit validation
    const validation = validateOrderPreSubmit({
      quote,
      book,
      liveTradingEnabled: this.config.liveTradingEnabled,
      mode: this.config.mode,
      exposureAllowed: opts.exposureAllowed,
      sellInventoryAvailable: opts.sellInventoryAvailable,
      killSwitchActive: opts.killSwitchActive,
    });

    if (!validation.valid) {
      return { submitted: false, reason: validation.reason };
    }

    // Shadow mode: calculate only, never submit
    if (this.config.mode === 'shadow') {
      return { submitted: false, reason: 'shadow_mode_no_submit' };
    }

    // Paper routing
    if (this.config.mode === 'paper') {
      // Adjust price if needed for post-only safety
      const postOnly = checkPostOnly(quote, book);
      const finalPrice = postOnly.adjustedPrice ?? quote.price;

      const orderId = `${quote.conditionId}-${quote.side}-${Date.now()}`;
      const paperOrder = {
        id: orderId,
        tokenId: quote.tokenId,
        side: quote.side,
        price: finalPrice,
        size: quote.size,
        sizeUsd: quote.size * finalPrice,
        postOnly: true as const,
      };

      // Cancel-before-replace (§11.2)
      const newId = this.cancelReplace.cancelAndReplace(existingOrderId, paperOrder);
      if (!newId) {
        return { submitted: false, reason: 'waiting_for_cancel_confirmation' };
      }

      return { submitted: true, orderId: newId, reason: 'paper_submitted' };
    }

    // Live / small_live routing
    if (this.config.mode === 'small_live') {
      if (!this.liveSubmitter) {
        return { submitted: false, reason: 'live_submitter_not_configured' };
      }

      // For live mode, post-only safety is enforced by the exchange,
      // but we still validate to avoid unnecessary rejects
      const postOnly = checkPostOnly(quote, book);
      if (!postOnly.safe) {
        return { submitted: false, reason: 'post_only_unsafe' };
      }

      let cancelledExistingOrderId: string | undefined;
      try {
        // Cancel existing live order before placing new one
        if (existingOrderId) {
          await this.liveSubmitter.cancel(existingOrderId);
          cancelledExistingOrderId = existingOrderId;
        }

        const submitQuote = postOnly.adjustedPrice !== undefined
          ? { ...quote, price: postOnly.adjustedPrice, sizeUsd: quote.size * postOnly.adjustedPrice }
          : quote;

        const result = await this.liveSubmitter.submit(submitQuote, {
          tickSize: book.tickSize,
        });

        return {
          submitted: true,
          orderId: result.orderID,
          reason: 'live_submitted',
          cancelledExistingOrderId,
          filledSize: result.filledSize,
          filledPrice: result.filledPrice,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { submitted: false, reason: `live_error:${message}`, cancelledExistingOrderId };
      }
    }

    return { submitted: false, reason: `unsupported_mode:${this.config.mode}` };
  }

  async cancelOrder(orderId: string): Promise<void> {
    if (this.config.mode === 'small_live' && this.liveSubmitter) {
      await this.liveSubmitter.cancel(orderId);
      return;
    }

    this.cancelReplace.initCancel(orderId);
  }

  async cancelAll(): Promise<void> {
    if (this.config.mode === 'small_live' && this.liveSubmitter) {
      const openOrders = await this.liveSubmitter.getOpenOrders();
      const results = await Promise.allSettled(
        openOrders
          .map((order) => order.id ?? order.orderID ?? order.orderId)
          .filter((orderId): orderId is string => typeof orderId === 'string' && orderId.length > 0)
          .map((orderId) => this.liveSubmitter!.cancel(orderId))
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) {
        console.error(`cancelAll: ${failed}/${results.length} cancels failed`);
      }
      return;
    }

    for (const order of this.engine.getOpenOrders()) {
      this.cancelReplace.initCancel(order.id);
    }
  }
}
