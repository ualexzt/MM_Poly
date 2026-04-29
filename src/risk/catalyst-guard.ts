import { MarketState } from '../types/market';

/**
 * Catalyst Guard — §4.1 / §4.3
 * Disables quoting when a known catalyst event is imminent.
 */

export interface CatalystEvent {
  conditionId: string;
  catalystAtMs: number; // unix ms timestamp when catalyst fires
}

export class CatalystGuard {
  private catalysts: Map<string, number> = new Map();

  /** Register or update a known catalyst time for a market. */
  setCatalyst(conditionId: string, catalystAtMs: number): void {
    this.catalysts.set(conditionId, catalystAtMs);
  }

  clearCatalyst(conditionId: string): void {
    this.catalysts.delete(conditionId);
  }

  /**
   * Returns true if a known catalyst is imminent (within bufferMs from now).
   * Default buffer = 60 seconds (matching GTD expires_before_catalyst §12.1).
   */
  isCatalystImminent(conditionId: string, bufferMs = 60_000): boolean {
    const catalystAt = this.catalysts.get(conditionId);
    if (catalystAt == null) return false;
    const msToEvent = catalystAt - Date.now();
    return msToEvent >= 0 && msToEvent <= bufferMs;
  }

  /** Load catalysts from MarketState.knownCatalystAt fields. */
  syncFromMarkets(markets: MarketState[]): void {
    for (const m of markets) {
      if (m.knownCatalystAt != null) {
        this.catalysts.set(m.conditionId, m.knownCatalystAt);
      } else {
        this.catalysts.delete(m.conditionId);
      }
    }
  }
}
