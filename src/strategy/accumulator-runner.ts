import { BookState } from '../types/book';
import { MarketState } from '../types/market';
import { AccumulatorConfig, AccumulatorDecision, Position, decideAccumulatorEntry } from '../engines/accumulator';
import { EqualizerConfig, decideEqualizer } from '../engines/equalizer';
import { RiskConfig, checkRisk } from '../risk/pair-cost-risk';
import { PositionTracker } from './position-tracker';

export interface MarketScanner {
  fetchMarkets(): Promise<MarketState[]>;
}

export interface OrderbookClient {
  fetchBook(conditionId: string, tokenId: string): Promise<BookState>;
}

export interface OrderManager {
  placeLimitOrder(params: { tokenId: string; side: 'BUY' | 'SELL'; price: number; size: number }): Promise<{ orderId: string | null; status: string; error?: string }>;
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
  getOrderbooks(): Map<string, { yes: BookState; no: BookState }>;
}

export interface CycleResult {
  decisions: AccumulatorDecision[];
}

export async function runAccumulatorCycle(input: AccumulatorCycleInput): Promise<CycleResult> {
  const {
    marketScanner, orderManager, logger,
    accumulatorConfig, equalizerConfig, riskConfig,
    currentBalanceUsd, getOrderbooks,
  } = input;

  const decisions: AccumulatorDecision[] = [];
  const tracker = new PositionTracker();

  try {
    const allMarkets = await marketScanner.fetchMarkets();
    const markets = allMarkets.filter(m => m.active && !m.closed && m.enableOrderBook && m.yesTokenId && m.noTokenId);

    // Cancel stale orders first
    await orderManager.cancelStaleOrders(60_000);

    const orderbooks = getOrderbooks();

    for (const market of markets) {
      const books = orderbooks.get(market.conditionId);
      if (!books) continue;

      const position = tracker.getPosition(market.conditionId);
      const pos: Position = position
        ? { yesQty: position.yesQty, noQty: position.noQty, avgYesPrice: position.avgYesPrice, avgNoPrice: position.avgNoPrice }
        : { yesQty: 0, noQty: 0, avgYesPrice: 0, avgNoPrice: 0 };

      // Check risk
      const exposure = pos.yesQty * pos.avgYesPrice + pos.noQty * pos.avgNoPrice;
      const openOrders = await orderManager.getOpenOrders();
      const risk = checkRisk({
        config: riskConfig,
        totalExposureUsd: tracker.getTotalExposureUsd(),
        marketExposureUsd: exposure,
        openOrderCount: openOrders.length,
        currentBalanceUsd,
      });

      if (!risk.allowed) {
        logger.write({ eventType: 'risk_blocked', marketId: market.conditionId, reason: risk.reason });
        continue;
      }

      // Try equalizer first (rebalance existing position)
      const eqDecision = decideEqualizer(pos, books.yes, books.no, equalizerConfig);
      if (eqDecision.side !== 'BALANCED') {
        const tokenId = eqDecision.side === 'YES' ? market.yesTokenId : market.noTokenId;
        const limitPrice = Math.max(0.01, (eqDecision.side === 'YES' ? books.yes.bestAsk! : books.no.bestAsk!) - equalizerConfig.limitOrderOffsetCents / 100);
        const result = await orderManager.placeLimitOrder({ tokenId, side: 'BUY', price: limitPrice, size: eqDecision.sizeUsd / limitPrice });
        logger.write({ eventType: 'equalizer_entry', marketId: market.conditionId, side: eqDecision.side, limitPrice, sizeUsd: eqDecision.sizeUsd, orderId: result.orderId, reason: eqDecision.reason });
        decisions.push({ side: eqDecision.side as 'YES' | 'NO', limitPrice, sizeUsd: eqDecision.sizeUsd, reason: eqDecision.reason });
        continue;
      }

      // Try accumulator (new entry)
      const accDecision = decideAccumulatorEntry(pos, books.yes, books.no, accumulatorConfig);
      if (accDecision.side !== 'SKIP') {
        const tokenId = accDecision.side === 'YES' ? market.yesTokenId : market.noTokenId;
        const result = await orderManager.placeLimitOrder({ tokenId, side: 'BUY', price: accDecision.limitPrice, size: accDecision.sizeUsd / accDecision.limitPrice });
        logger.write({ eventType: 'accumulator_entry', marketId: market.conditionId, ...accDecision, orderId: result.orderId });
        decisions.push(accDecision);
      }
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
