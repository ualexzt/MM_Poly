import { MicroGabagoolClobOrderbookClient, MicroGabagoolTopOfBook } from '../data/micro-gabagool-clob-orderbook-client';
import { MarketCandidate } from '../run-micro-gabagool';
import { RollingMarketStats } from './micro-gabagool-rolling-stats';

export interface GammaMicroGabagoolScannerConfig {
  gammaBaseUrl: string;
  maxMarketsPerScan: number;
  fetchFn?: typeof fetch;
  nowMs: () => number;
}

export interface MicroGabagoolOrderbookReader {
  getTopOfBook(tokenId: string): Promise<MicroGabagoolTopOfBook | null>;
}

type GammaMarketPayload = Record<string, unknown>;

function asGammaMarketPayload(value: unknown): GammaMarketPayload | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  return value as GammaMarketPayload;
}

function extractYesTokenId(clobTokenIds: unknown): string | null {
  let tokenIds: unknown;

  if (typeof clobTokenIds === 'string') {
    try {
      tokenIds = JSON.parse(clobTokenIds) as unknown;
    } catch {
      return null;
    }
  } else {
    tokenIds = clobTokenIds;
  }

  if (!Array.isArray(tokenIds) || typeof tokenIds[0] !== 'string' || tokenIds[0].trim() === '') {
    return null;
  }

  return tokenIds[0];
}

function extractEndMs(market: GammaMarketPayload): number | null {
  const rawEndDate = market.endDate ?? market.endDateIso ?? market.end_date_iso;
  if (typeof rawEndDate !== 'string') {
    return null;
  }

  const endMs = Date.parse(rawEndDate);
  return Number.isFinite(endMs) ? endMs : null;
}

export class GammaMicroGabagoolScanner {
  private readonly gammaBaseUrl: string;
  private readonly maxMarketsPerScan: number;
  private readonly fetchFn: typeof fetch;
  private readonly nowMs: () => number;
  private readonly rollingStats: RollingMarketStats;

  constructor(
    config: GammaMicroGabagoolScannerConfig,
    private readonly orderbookClient: MicroGabagoolClobOrderbookClient | MicroGabagoolOrderbookReader,
    rollingStats: RollingMarketStats = new RollingMarketStats(),
  ) {
    this.gammaBaseUrl = config.gammaBaseUrl.replace(/\/+$/, '');
    this.maxMarketsPerScan = config.maxMarketsPerScan;
    this.fetchFn = config.fetchFn ?? fetch;
    this.nowMs = config.nowMs;
    this.rollingStats = rollingStats;
  }

  async scan(): Promise<MarketCandidate[]> {
    const response = await this.fetchFn(`${this.gammaBaseUrl}/markets?active=true&closed=false&limit=${this.maxMarketsPerScan}`);
    if (!response.ok) {
      throw new Error(`Gamma API error: ${response.status}`);
    }

    const payload = await response.json();
    if (!Array.isArray(payload)) {
      throw new Error('Gamma API: unexpected response');
    }

    const candidates: MarketCandidate[] = [];

    for (const rawMarket of payload) {
      const market = asGammaMarketPayload(rawMarket);
      if (!market || market.active !== true || market.closed === true) {
        continue;
      }

      const conditionId = market.conditionId;
      if (typeof conditionId !== 'string' || conditionId.trim() === '') {
        continue;
      }

      const tokenId = extractYesTokenId(market.clobTokenIds);
      if (!tokenId) {
        continue;
      }

      const endMs = extractEndMs(market);
      if (endMs === null) {
        continue;
      }

      let topOfBook: MicroGabagoolTopOfBook | null;
      try {
        topOfBook = await this.orderbookClient.getTopOfBook(tokenId);
      } catch {
        continue;
      }

      if (!topOfBook) {
        continue;
      }

      const timestampMs = this.nowMs();
      const stats = this.rollingStats.update(conditionId, {
        timestampMs,
        bestBid: topOfBook.bestBid,
        bestAsk: topOfBook.bestAsk,
        bestBidSizeUsd: topOfBook.bestBidSizeUsd,
        bestAskSizeUsd: topOfBook.bestAskSizeUsd,
      });

      candidates.push({
        conditionId,
        tokenId,
        bestBid: topOfBook.bestBid,
        bestAsk: topOfBook.bestAsk,
        bestBidSizeUsd: topOfBook.bestBidSizeUsd,
        bestAskSizeUsd: topOfBook.bestAskSizeUsd,
        timeToSettlementMin: Math.max(0, Math.floor((endMs - timestampMs) / 60_000)),
        hasRecentTrades: true,
        wmpDelta3Min: stats.wmpDelta3Min,
        spreadChangesLast60Sec: stats.spreadChangesLast60Sec,
      });
    }

    return candidates;
  }
}
