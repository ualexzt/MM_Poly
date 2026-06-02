import { BookState } from '../types/book';
import { MarketState } from '../types/market';
import { AccumulatorConfig, AccumulatorDecision, Position, decideAccumulatorEntry } from '../engines/accumulator';
import { EqualizerConfig, EqualizerDecision, decideEqualizer } from '../engines/equalizer';
import { RiskConfig, checkRisk } from '../risk/pair-cost-risk';
import { PositionTracker } from './position-tracker';

export interface MarketScanner {
  fetchMarkets(): Promise<MarketState[]>;
}

export interface OrderbookClient {
  fetchBook(conditionId: string, tokenId: string): Promise<BookState>;
}

export interface OrderManager {
  placeLimitOrder(params: { tokenId: string; side: 'BUY' | 'SELL'; price: number; size: number; postOnly?: boolean }): Promise<{ orderId: string | null; status: string; error?: string }>;
  cancelStaleOrders(lifetimeMs: number): Promise<string[]>;
  getOpenOrders(): Promise<{ orderId: string; tokenId: string; createdAt: number }[]>;
}

export interface EventLogger {
  write(event: Record<string, unknown>): boolean;
}

export interface AccumulatorCycleInput {
  marketScanner: MarketScanner;
  orderbookClient: OrderbookClient;
  orderManager: OrderManager;
  logger: EventLogger;
  accumulatorConfig: AccumulatorConfig;
  equalizerConfig: EqualizerConfig;
  riskConfig: RiskConfig;
  currentBalanceUsd: number;
  tracker: PositionTracker;
  getOrderbooks(): Map<string, { yes: BookState; no: BookState }>;
  nowMs?: () => number;
  recordFillOnOrderPlacement?: boolean;
  postOnlyOrders?: boolean;
}

export interface CycleResult {
  decisions: Array<AccumulatorDecision | EqualizerDecision>;
}

export async function runAccumulatorCycle(input: AccumulatorCycleInput): Promise<CycleResult> {
  const {
    marketScanner, orderManager, logger,
    accumulatorConfig, equalizerConfig, riskConfig,
    currentBalanceUsd, tracker, getOrderbooks,
  } = input;
  const recordFillOnOrderPlacement = input.recordFillOnOrderPlacement ?? true;
  const postOnlyOrders = input.postOnlyOrders ?? false;

  const decisions: Array<AccumulatorDecision | EqualizerDecision> = [];

  try {
    const now = input.nowMs ? input.nowMs() : Date.now();
    for (const closed of tracker.closeExpiredPositions(now)) {
      logger.write({ eventType: 'market_expired', ...closed });
    }

    const allMarkets = await marketScanner.fetchMarkets();
    const markets = allMarkets.filter(m => m.active && !m.closed && m.enableOrderBook && m.yesTokenId && m.noTokenId);

    await orderManager.cancelStaleOrders(60_000);

    const orderbooks = getOrderbooks();

    for (const market of markets) {
      const books = orderbooks.get(market.conditionId);
      if (!books) continue;

      const marketEndMs = market.endDate ? Date.parse(market.endDate) : undefined;
      const existing = tracker.getPosition(market.conditionId);
      const pos: Position = existing
        ? {
          yesQty: existing.yesQty,
          noQty: existing.noQty,
          avgYesPrice: existing.avgYesPrice,
          avgNoPrice: existing.avgNoPrice,
        }
        : { yesQty: 0, noQty: 0, avgYesPrice: 0, avgNoPrice: 0 };
      const marketExposureUsd = existing ? existing.totalYesCostUsd + existing.totalNoCostUsd : 0;

      // Check risk
      const openOrders = await orderManager.getOpenOrders();
      const risk = checkRisk({
        config: riskConfig,
        totalExposureUsd: tracker.getTotalExposureUsd(),
        marketExposureUsd,
        openOrderCount: openOrders.length,
        currentBalanceUsd,
      });

      if (!risk.allowed) {
        logger.write({ eventType: 'risk_blocked', marketId: market.conditionId, reason: risk.reason });
        continue;
      }

      const imbalance = pos.yesQty - pos.noQty;
      if (Math.abs(imbalance) > equalizerConfig.imbalanceThreshold) {
        const eqDecision = decideEqualizer(pos, books.yes, books.no, equalizerConfig);
        if (eqDecision.side !== 'BALANCED') {
          const tokenId = eqDecision.side === 'YES' ? market.yesTokenId : market.noTokenId;
          const result = await orderManager.placeLimitOrder({ tokenId, side: 'BUY', price: eqDecision.limitPrice, size: eqDecision.sizeShares, postOnly: postOnlyOrders });
          if (result.status !== 'LIVE' || !result.orderId) {
            logger.write({ eventType: 'order_failed', marketId: market.conditionId, decisionType: 'equalizer_rebalance', ...eqDecision, orderStatus: result.status, error: result.error });
            continue;
          }
          if (recordFillOnOrderPlacement) {
            tracker.updateFill(market.conditionId, eqDecision.side, eqDecision.limitPrice, eqDecision.sizeShares, marketEndMs);
          }
          logger.write({ eventType: 'equalizer_rebalance', marketId: market.conditionId, ...eqDecision, orderId: result.orderId });
          decisions.push(eqDecision);
          break;
        }

        logger.write({ eventType: 'equalizer_skip', marketId: market.conditionId, reason: eqDecision.reason });
        continue;
      }

      // Original Gabagool accumulator: evaluate current position averages and execute one best opportunity.
      const accDecision = decideAccumulatorEntry(pos, books.yes, books.no, accumulatorConfig);
      if (accDecision.side !== 'SKIP') {
        const tokenId = accDecision.side === 'YES' ? market.yesTokenId : market.noTokenId;
        const result = await orderManager.placeLimitOrder({ tokenId, side: 'BUY', price: accDecision.limitPrice, size: accDecision.sizeShares, postOnly: postOnlyOrders });
        if (result.status !== 'LIVE' || !result.orderId) {
          logger.write({ eventType: 'order_failed', marketId: market.conditionId, decisionType: 'accumulator_entry', ...accDecision, orderStatus: result.status, error: result.error });
          continue;
        }
        if (recordFillOnOrderPlacement) {
          tracker.updateFill(market.conditionId, accDecision.side, accDecision.limitPrice, accDecision.sizeShares, marketEndMs);
        }
        logger.write({ eventType: 'accumulator_entry', marketId: market.conditionId, ...accDecision, orderId: result.orderId });
        decisions.push(accDecision);
        break;
      }

      logger.write({ eventType: 'accumulator_skip', marketId: market.conditionId, reason: accDecision.reason });
    }

    if (decisions.length === 0) {
      logger.write({ eventType: 'no_decisions', marketsScanned: markets.length });
    }

    return { decisions };
  } catch (err) {
    logger.write({ eventType: 'cycle_error', error: (err as Error).message });
    return { decisions: [] };
  }
}
