import { StrategyConfig } from '../types/config';
import { MarketState } from '../types/market';
import { BookState } from '../types/book';
import { FlowState } from '../types/flow';
import { MarketScanner } from '../data/gamma-market-scanner';
import { OrderbookClient } from '../data/clob-orderbook-client';
import { PaperExecutionEngine } from '../simulation/paper-execution-engine';
import { Logger } from '../utils/logger';
import { filterEligibleMarkets } from './market-selector';
import { computeFairPrice, checkComplementConsistency } from '../engines/fair-price-engine';
import { computeToxicityScore, getToxicityAction, checkHardToxicityCancel } from '../engines/toxicity-engine';
import { computeInventorySkew, checkSellInventoryAvailable } from '../engines/inventory-engine';
import { computeInventoryThrottle } from '../engines/inventory-throttle';
import { InventoryTracker } from '../engines/inventory-tracker';
import { generateQuoteCandidate, computeTargetHalfSpread } from '../engines/quote-engine';
import { checkExposureLimits } from '../risk/exposure-limits';
import { KillSwitch, isNearResolution, hasTickSizeChanged } from '../risk/kill-switch';
import { ResolutionWindowGuard } from '../risk/resolution-window-guard';
import { CatalystGuard } from '../risk/catalyst-guard';
import { isBookStale } from '../risk/stale-book-guard';
import { OrderRouter } from '../execution/order-router';
import { LiveOrderSubmitter } from '../execution/live-order-submitter';
import { OpenOrderReconciler } from '../execution/open-order-reconciler';
import { classifyFill } from '../accounting/fill-classifier';
import { createTrace } from '../accounting/decision-trace';

export interface StrategyRunnerDeps {
  config: StrategyConfig;
  scanner: MarketScanner;
  bookClient: OrderbookClient;
  paperEngine: PaperExecutionEngine;
  liveSubmitter?: LiveOrderSubmitter;
  logger: Logger;
  maxMarkets?: number;
}

interface ActiveOrderSlot {
  orderId: string | null;
  price: number;
  size: number;
  submittedAt: number;
}

interface MarketOrderSlots {
  buy: ActiveOrderSlot;
  sell: ActiveOrderSlot;
}

/** Tracks tick sizes to detect changes (§13.2 kill switch) */
interface TickSizeRecord {
  yesTickSize: number;
  noTickSize: number;
}

export class StrategyRunner {
  private killSwitch: KillSwitch;
  private resolutionGuard: ResolutionWindowGuard;
  private catalystGuard: CatalystGuard;
  private inventory: InventoryTracker;
  private orderRouter: OrderRouter;
  private reconciler: OpenOrderReconciler;

  // Per-market order slots: conditionId → {buy, sell}
  private activeOrders: Map<string, MarketOrderSlots> = new Map();
  // Book cache
  private books: Map<string, BookState> = new Map();
  // Flow cache (updated externally from WS)
  private flows: Map<string, FlowState> = new Map();
  // Tick size history for change detection
  private tickSizes: Map<string, TickSizeRecord> = new Map();
  // Cached WS disconnect seconds for toxicity engine
  private wsDisconnectedSeconds = 0;

  constructor(private deps: StrategyRunnerDeps) {
    const { config, paperEngine } = deps;
    this.killSwitch = new KillSwitch(config.risk);
    this.resolutionGuard = new ResolutionWindowGuard(config.risk.disableNearResolutionMinutes);
    this.catalystGuard = new CatalystGuard();
    this.inventory = new InventoryTracker(config.inventory, config.inventory.maxTotalStrategyExposureUsd);
    this.orderRouter = new OrderRouter(paperEngine, {
      mode: config.mode,
      liveTradingEnabled: config.liveTradingEnabled,
    }, deps.liveSubmitter ?? null);
    this.reconciler = new OpenOrderReconciler(paperEngine);
  }

  /** Update a book in the cache (called from WS stream handler) */
  updateBook(tokenId: string, book: BookState): void {
    this.books.set(tokenId, book);
  }

  /** Update flow state in the cache */
  updateFlow(tokenId: string, flow: FlowState): void {
    this.flows.set(tokenId, flow);
  }

  async runCycle(
    wsStatus?: { connected: boolean; disconnectedAt: number | null }
  ): Promise<void> {
    const { config, scanner, bookClient, paperEngine, logger } = this.deps;

    // §2 — disabled mode: no quoting
    if (config.mode === 'disabled') {
      logger.info('Strategy disabled');
      return;
    }

    // §13.2 — Global kill switch check
    const wsStatusFinal = wsStatus ?? { connected: true, disconnectedAt: null };
    this.wsDisconnectedSeconds = wsStatusFinal.connected
      ? 0
      : (wsStatusFinal.disconnectedAt != null ? (Date.now() - wsStatusFinal.disconnectedAt) / 1000 : 0);
    const ks = this.killSwitch.check(
      wsStatusFinal,
      { errorsLast60s: 0, totalLast60s: 100 },
      { currentDrawdownPct: 0 }
    );

    if (ks === 'CANCEL_ALL' || ks === 'DISABLE_STRATEGY') {
      logger.warn('Kill switch triggered', { state: ks });
      await this.orderRouter.cancelAll();
      if (ks === 'DISABLE_STRATEGY') return;
    }

    // §11.1 step 1 — Fetch markets
    const markets = await scanner.fetchMarkets();
    this.catalystGuard.syncFromMarkets(markets);
    
    // Phase 1: Basic filters (no book data needed)
    const basicEligible = filterEligibleMarkets(markets, config.marketFilter);
    const basicActive = this.deps.maxMarkets != null ? basicEligible.slice(0, this.deps.maxMarkets) : basicEligible;
    
    // Phase 2: Pre-fetch books for basic-eligible markets
    for (const market of basicActive) {
      try {
        const yesBook = await bookClient.fetchBook(market.conditionId, market.yesTokenId);
        const noBook = await bookClient.fetchBook(market.conditionId, market.noTokenId);
        this.books.set(market.yesTokenId, yesBook);
        this.books.set(market.noTokenId, noBook);
      } catch (err) {
        logger.warn('Failed to pre-fetch book', { conditionId: market.conditionId, error: String(err) });
      }
    }
    
    // Phase 3: Re-filter with book data (spread, depth, midpoint filters)
    const eligible = filterEligibleMarkets(markets, config.marketFilter, this.books);
    const activeMarkets = this.deps.maxMarkets != null ? eligible.slice(0, this.deps.maxMarkets) : eligible;
    await this._cancelOrdersOutsideActiveUniverse(new Set(activeMarkets.map((market) => market.conditionId)));

    for (const market of activeMarkets) {
      try {
        await this.processMarket(market);
      } catch (err) {
        logger.error('Cycle error', { conditionId: market.conditionId, error: String(err) });
      }
    }
  }

  private async processMarket(market: MarketState): Promise<void> {
    const { config, bookClient, paperEngine, logger } = this.deps;

    // §11.1 step 2 — Use cached books or fetch if missing
    let yesBook = this.books.get(market.yesTokenId);
    let noBook = this.books.get(market.noTokenId);
    if (!yesBook || !noBook) {
      yesBook = await bookClient.fetchBook(market.conditionId, market.yesTokenId);
      noBook = await bookClient.fetchBook(market.conditionId, market.noTokenId);
      this.books.set(market.yesTokenId, yesBook);
      this.books.set(market.noTokenId, noBook);
    }

    // §11.1 step 5 — Hard risk checks

    // Stale book guard (§8.4)
    if (
      isBookStale(yesBook.lastUpdateMs, config.staleOrderMaxAgeMs) ||
      isBookStale(noBook.lastUpdateMs, config.staleOrderMaxAgeMs)
    ) {
      logger.warn('Stale book — skipping market', { conditionId: market.conditionId });
      await this._cancelMarketOrders(market.conditionId);
      return;
    }

    // Resolution window guard (§13.2)
    if (this.resolutionGuard.shouldDisable(market.endDate)) {
      logger.info('Near resolution — cancelling market orders', { conditionId: market.conditionId });
      await this._cancelMarketOrders(market.conditionId);
      return;
    }

    // Catalyst guard (§4.3)
    if (this.catalystGuard.isCatalystImminent(market.conditionId)) {
      logger.info('Catalyst imminent — skipping market', { conditionId: market.conditionId });
      await this._cancelMarketOrders(market.conditionId);
      return;
    }

    // Tick-size change detection (§13.2)
    const prevTicks = this.tickSizes.get(market.conditionId);
    if (prevTicks && hasTickSizeChanged(yesBook.tickSize, prevTicks.yesTickSize)) {
      logger.warn('Tick size changed — cancelling and repricing', { conditionId: market.conditionId });
      await this._cancelMarketOrders(market.conditionId);
      this.killSwitch.resetAdverseFills();
    }
    this.tickSizes.set(market.conditionId, {
      yesTickSize: yesBook.tickSize,
      noTickSize: noBook.tickSize,
    });

    // §11.1 step 3 — Update flow state
    const flow = this.flows.get(market.yesTokenId);

    // §11.1 step 4 — Inventory state
    const yesPrice = yesBook.midpoint ?? 0.5;
    const noPrice = noBook.midpoint ?? 0.5;
    const invState = this.inventory.getState(
      market.conditionId,
      market.yesTokenId,
      market.noTokenId,
      yesPrice,
      noPrice
    );

    // §11.1 step 8 — Toxicity score
    let toxicityScore = 0;
    if (flow) {
      toxicityScore = computeToxicityScore(flow);
    }
    const toxicityAction = getToxicityAction(toxicityScore);

    // §8.4 — Hard toxicity cancels
    const bookStaleMs = Date.now() - yesBook.lastUpdateMs;
    const hardCancel = checkHardToxicityCancel(
      {
        midpointMove10sCents: flow?.midpointChange10sCents ?? 0,
        midpointMove60sCents: flow?.midpointChange60sCents ?? 0,
        largeTradeUsd: 0,
        bookHashChanges10s: flow?.bookHashChanges10s ?? 0,
        spreadTicks: yesBook.spreadTicks ?? 99,
        bookStaleMs,
        wsDisconnectedSeconds: this.wsDisconnectedSeconds,
      },
      config.toxicity
    );

    if (hardCancel || toxicityAction === 'cancel_all_market_orders') {
      logger.warn('Hard toxicity cancel', { conditionId: market.conditionId, toxicityScore });
      await this._cancelMarketOrders(market.conditionId);
      return;
    }

    // Exit-only mode from toxicity
    const exitOnly = toxicityAction === 'quote_exit_only_or_cancel';

    // §9.4 — Hard inventory limit: exit-only
    if (invState.hardLimitBreached) {
      logger.warn('Hard inventory limit — exit only', { conditionId: market.conditionId });
    }

    // §11.1 step 7 — Fair price
    const yesFair = computeFairPrice({
      bestBid: yesBook.bestBid ?? 0,
      bestAsk: yesBook.bestAsk ?? 0,
      bestBidSize: yesBook.bestBidSizeUsd,
      bestAskSize: yesBook.bestAskSizeUsd,
      lastTradeEma: yesBook.lastTradePrice ?? null,
      complementMidpoint: noBook.midpoint,
      weights: config.fairPrice.weights,
    });

    if (!yesFair) {
      logger.warn('Fair price invalid', { conditionId: market.conditionId });
      return;
    }

    // §7.4 — Complement consistency check
    // noFair is approximated as 1 - yesFair (binary market)
    const noFairApprox = 1 - yesFair.fairPrice;
    if (!checkComplementConsistency(yesFair.fairPrice, noFairApprox, config.fairPrice.complementConsistencyToleranceCents)) {
      logger.warn('Complement consistency failed — skipping market', { conditionId: market.conditionId, yesFair: yesFair.fairPrice });
      return;
    }

    // §11.1 step 9 — Inventory skew
    const inventorySkewCents = computeInventorySkew(
      invState.inventoryPct,
      config.inventory.maxSkewCents,
      config.inventory.skewSensitivity
    );

    // §11.1 steps 10-14 — Generate, validate, diff, cancel stale, submit
    const slots = this._getOrCreateSlots(market.conditionId);
    const netPosition = invState.yesTokens - invState.noTokens;
    const inventoryIncreasingSide: 'BUY' | 'SELL' | null =
      netPosition > 0 ? 'BUY' : netPosition < 0 ? 'SELL' : null;

    for (const side of ['BUY', 'SELL'] as const) {
      // §9.4 — exit-only/hard-limit: cancel and block only the inventory-increasing side.
      if ((exitOnly || invState.hardLimitBreached) && side === inventoryIncreasingSide) {
        await this._cancelSideOrder(slots, side);
        continue;
      }

      // §9.5 — Sell guard
      const tokenBalance = this.inventory.getTokenBalance(market.yesTokenId);
      if (side === 'SELL' && !checkSellInventoryAvailable(side, 0.1, tokenBalance)) {
        logger.info('No sell inventory', { conditionId: market.conditionId });
        continue;
      }

      // §10 — Generate quote candidate
      const inventoryThrottle = computeInventoryThrottle({
        mode: config.mode,
        profiles: config.inventory.throttleProfiles,
        netPosition: invState.yesTokens - invState.noTokens,
        inventoryUsagePct: Math.abs(invState.inventoryPct),
        side,
      });

      const result = generateQuoteCandidate({
        conditionId: market.conditionId,
        tokenId: market.yesTokenId,
        side,
        fairPrice: yesFair.fairPrice,
        book: yesBook,
        spread: config.spread,
        size: config.size,
        toxicityScore,
        inventoryPct: invState.inventoryPct,
        inventorySkewCents,
        rewardConfig: market.rewardConfig,
        isBookStale: false,
        inventoryThrottle,
      });

      if (!result) {
        logger.info('No valid quote candidate', { conditionId: market.conditionId, side });
        continue;
      }

      const { candidate } = result;

      // §5 / §12.2 — Exposure limits check before submit (C5)
      const exposureCheck = checkExposureLimits(invState, config.inventory);
      const exposureAllowed = exposureCheck.allowed || side === 'SELL'; // sells reduce exposure

      // §12.2 — Sell inventory check
      const sellInventoryAvailable = checkSellInventoryAvailable(side, candidate.size, tokenBalance);

      // §11.1 step 15 — Decision trace
      const slot = side === 'BUY' ? slots.buy : slots.sell;
      const trace = createTrace({
        mode: config.mode,
        conditionId: market.conditionId,
        tokenId: market.yesTokenId,
        side,
        bestBid: yesBook.bestBid,
        bestAsk: yesBook.bestAsk,
        spreadTicks: yesBook.spreadTicks,
        fairPrice: yesFair.fairPrice,
        microprice: yesFair.microprice,
        complementFair: noBook.midpoint,
        lastTradeEma: yesBook.lastTradePrice ?? null,
        toxicityScore,
        inventoryPct: invState.inventoryPct,
        inventorySkewCents,
        targetPrice: candidate.price,
        targetSizeUsd: candidate.sizeUsd,
        decision: exposureAllowed ? 'quote' : 'disabled_by_risk',
        reason: exposureAllowed ? candidate.reason : (exposureCheck.reason ?? 'exposure_exceeded'),
        riskFlags: candidate.riskFlags,
      });

      this.deps.logger.trace(trace);

      if (!exposureAllowed) {
        console.log('EXPOSURE_BLOCKED', { side, conditionId: market.conditionId, reason: exposureCheck.reason });
        continue;
      }

      // §11.2 — Route through cancel-replace
      logger.info('ROUTING_ORDER', { side, price: candidate.price, tokenId: market.yesTokenId?.slice(0,20) });
      const routeResult = await this.orderRouter.route(
        candidate,
        yesBook,
        slot.orderId,
        {
          exposureAllowed,
          sellInventoryAvailable,
          killSwitchActive: false,
        }
      );

      if (routeResult.cancelledExistingOrderId && slot.orderId === routeResult.cancelledExistingOrderId) {
        slot.orderId = null;
      }

      if (routeResult.submitted && routeResult.orderId) {
        if (side === 'BUY') {
          slots.buy = { orderId: routeResult.orderId, price: candidate.price, size: candidate.size, submittedAt: Date.now() };
        } else {
          slots.sell = { orderId: routeResult.orderId, price: candidate.price, size: candidate.size, submittedAt: Date.now() };
        }
      }
    }
  }

  /** Clear locally tracked live order slots when the exchange reports a terminal order state. */
  onOrderUpdate(orderId: string, status: 'open' | 'filled' | 'cancelled' | 'canceled' | 'rejected' | 'partially_filled'): void {
    if (status !== 'filled' && status !== 'cancelled' && status !== 'canceled' && status !== 'rejected') return;

    for (const slots of this.activeOrders.values()) {
      if (slots.buy.orderId === orderId) slots.buy.orderId = null;
      if (slots.sell.orderId === orderId) slots.sell.orderId = null;
    }
  }

  /** Process a fill event — update inventory, classify fill, record in kill switch */
  /** Expose inventory tracker for startup reconciliation and diagnostics */
  getInventory(): InventoryTracker {
    return this.inventory;
  }

  onFill(
    conditionId: string,
    tokenId: string,
    side: 'BUY' | 'SELL',
    price: number,
    size: number,
    midpoint30sLater?: number
  ): void {
    // Update inventory
    this.inventory.onFill(conditionId, tokenId, side, price, size);

    // Classify fill for kill switch (§13.3)
    if (midpoint30sLater !== undefined) {
      const classification = classifyFill(side, price, midpoint30sLater);
      this.killSwitch.recordFill(classification === 'adverse');
    }
  }

  private _getOrCreateSlots(conditionId: string): MarketOrderSlots {
    let slots = this.activeOrders.get(conditionId);
    if (!slots) {
      const emptySlot: ActiveOrderSlot = { orderId: null, price: 0, size: 0, submittedAt: 0 };
      slots = { buy: { ...emptySlot }, sell: { ...emptySlot } };
      this.activeOrders.set(conditionId, slots);
    }
    return slots;
  }

  private async _cancelSideOrder(slots: MarketOrderSlots, side: 'BUY' | 'SELL'): Promise<void> {
    const slot = side === 'BUY' ? slots.buy : slots.sell;
    if (!slot.orderId) return;

    try {
      await this.orderRouter.cancelOrder(slot.orderId);
      slot.orderId = null;
    } catch (err) {
      this.deps.logger.error('Failed to cancel inventory-increasing order', {
        side,
        orderId: slot.orderId,
        error: String(err),
      });
    }
  }

  private async _cancelOrdersOutsideActiveUniverse(activeConditionIds: Set<string>): Promise<void> {
    for (const conditionId of this.activeOrders.keys()) {
      if (!activeConditionIds.has(conditionId)) {
        await this._cancelMarketOrders(conditionId);
      }
    }
  }

  private async _cancelMarketOrders(conditionId: string): Promise<void> {
    const slots = this.activeOrders.get(conditionId);
    if (!slots) return;

    const cancellations: Array<{ side: 'buy' | 'sell'; orderId: string }> = [];
    if (slots.buy.orderId) cancellations.push({ side: 'buy', orderId: slots.buy.orderId });
    if (slots.sell.orderId) cancellations.push({ side: 'sell', orderId: slots.sell.orderId });

    const results = await Promise.allSettled(
      cancellations.map((cancel) => this.orderRouter.cancelOrder(cancel.orderId))
    );

    results.forEach((result, index) => {
      const cancel = cancellations[index];
      if (result.status === 'fulfilled') {
        slots[cancel.side].orderId = null;
      } else {
        this.deps.logger.error('Failed to cancel market order', {
          conditionId,
          side: cancel.side,
          orderId: cancel.orderId,
          error: String(result.reason),
        });
      }
    });

    // Clean up empty slot entries to prevent memory leak
    if (!slots.buy.orderId && !slots.sell.orderId) {
      this.activeOrders.delete(conditionId);
    }
  }
}
