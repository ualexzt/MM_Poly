import { InventoryState } from '../types/inventory';
import { InventoryConfig } from '../types/config';

/**
 * Inventory Tracker — §9
 * Maintains real-time inventory state from paper fills.
 */

interface TokenBalance {
  tokens: number;   // positive = long
  avgCost: number;  // avg entry price
}

export class InventoryTracker {
  private balances: Map<string, TokenBalance> = new Map();
  private pusdAvailable: number;

  // Market → event → strategy groupings (simplified: one event per conditionId)
  private marketExposures: Map<string, number> = new Map();

  constructor(
    private config: InventoryConfig,
    initialCapitalUsd: number
  ) {
    this.pusdAvailable = initialCapitalUsd;
  }

  /**
   * Record a fill and update balances (§9).
   */
  onFill(
    conditionId: string,
    tokenId: string,
    side: 'BUY' | 'SELL',
    price: number,
    size: number
  ): void {
    const bal = this.balances.get(tokenId) ?? { tokens: 0, avgCost: 0 };
    const fillUsd = price * size;

    if (side === 'BUY') {
      this.pusdAvailable -= fillUsd;
      if (bal.tokens >= 0) {
        const totalCost = bal.avgCost * bal.tokens + fillUsd;
        bal.tokens += size;
        bal.avgCost = bal.tokens > 0 ? totalCost / bal.tokens : 0;
      } else {
        bal.tokens += size;
        if (bal.tokens > 0) bal.avgCost = price;
      }
    } else {
      this.pusdAvailable += fillUsd;
      if (bal.tokens <= 0) {
        const totalCost = bal.avgCost * Math.abs(bal.tokens) + fillUsd;
        bal.tokens -= size;
        bal.avgCost = bal.tokens < 0 ? totalCost / Math.abs(bal.tokens) : 0;
      } else {
        bal.tokens -= size;
        if (bal.tokens < 0) bal.avgCost = price;
      }
    }

    this.balances.set(tokenId, bal);

    // Update market exposure
    const exposureUsd = Math.abs(bal.tokens) * price;
    this.marketExposures.set(conditionId, exposureUsd);
  }

  /**
   * Build a full InventoryState for a given market (§6.5).
   */
  getState(
    conditionId: string,
    yesTokenId: string,
    noTokenId: string,
    yesPrice: number,
    noPrice: number
  ): InventoryState {
    const yes = this.balances.get(yesTokenId) ?? { tokens: 0, avgCost: 0 };
    const no = this.balances.get(noTokenId) ?? { tokens: 0, avgCost: 0 };

    const yesExposureUsd = yes.tokens * yesPrice;
    const noExposureUsd = no.tokens * noPrice;
    const netYesExposureUsd = yesExposureUsd - noExposureUsd;
    const marketExposureUsd = Math.abs(yesExposureUsd) + Math.abs(noExposureUsd);

    // For event/strategy exposure, simplified: aggregate across all markets
    const totalExposureUsd = this.getTotalExposureUsd();

    // inventoryPct: ratio of market exposure to max allowed (in %, 0-100)
    const inventoryPct =
      this.config.maxMarketExposureUsd > 0
        ? (marketExposureUsd / this.config.maxMarketExposureUsd) * 100
        : 0;

    const softLimitBreached = inventoryPct >= this.config.softLimitPct;   // 35
    const hardLimitBreached = inventoryPct >= this.config.hardLimitPct;   // 65

    return {
      conditionId,
      pusdAvailable: this.pusdAvailable,
      yesTokens: yes.tokens,
      noTokens: no.tokens,
      yesExposureUsd,
      noExposureUsd,
      netYesExposureUsd,
      marketExposureUsd,
      eventExposureUsd: marketExposureUsd,        // simplified: event = market
      strategyExposureUsd: totalExposureUsd,
      inventoryPct,
      softLimitBreached,
      hardLimitBreached,
    };
  }

  getTokenBalance(tokenId: string): number {
    return this.balances.get(tokenId)?.tokens ?? 0;
  }

  getTotalExposureUsd(): number {
    let total = 0;
    for (const [, v] of this.balances) {
      total += Math.abs(v.tokens) * v.avgCost;
    }
    return total;
  }

  getPusdAvailable(): number {
    return this.pusdAvailable;
  }
}
