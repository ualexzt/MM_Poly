import { PaperExecutionEngine } from '../simulation/paper-execution-engine';
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
    private config: OrderRouterConfig
  ) {
    this.cancelReplace = new CancelReplaceEngine(engine);
  }

  /**
   * Route a validated quote candidate.
   * @param existingOrderId - orderId to cancel-replace (null = new order)
   */
  route(
    quote: QuoteCandidate,
    book: BookState,
    existingOrderId: string | null,
    opts: {
      exposureAllowed: boolean;
      sellInventoryAvailable: boolean;
      killSwitchActive: boolean;
    }
  ): RouteResult {
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

    // Paper / small_live routing
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

    return { submitted: false, reason: `unsupported_mode:${this.config.mode}` };
  }

  cancelOrder(orderId: string): void {
    this.cancelReplace.initCancel(orderId);
  }

  cancelAll(): void {
    for (const order of this.engine.getOpenOrders()) {
      this.cancelReplace.initCancel(order.id);
    }
  }
}
