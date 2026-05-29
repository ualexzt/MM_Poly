const FETCH_TIMEOUT_MS = 10_000;

async function fetchWithTimeout(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export interface PolymarketPosition {
  tokenId: string;
  conditionId: string;
  size: number;
  avgPrice: number;
  curPrice: number;
  initialValue: number;
  currentValue: number;
  cashPnl: number;
  realizedPnl: number;
  outcome: string;
  title: string;
  slug: string;
  redeemable: boolean;
}

export class DataApiClient {
  private baseUrl: string;
  private walletAddress: string;

  constructor(baseUrl: string, walletAddress: string) {
    this.baseUrl = baseUrl;
    this.walletAddress = walletAddress;
  }

  /**
   * Map raw API positions to typed PolymarketPosition array.
   * Exported for testing.
   */
  mapRawPositions(raw: any[]): PolymarketPosition[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((p: any) => parseFloat(p.size) > 0)
      .map((p: any) => ({
        tokenId: p.asset,
        conditionId: p.conditionId,
        size: parseFloat(p.size),
        avgPrice: parseFloat(p.avgPrice),
        curPrice: parseFloat(p.curPrice),
        initialValue: parseFloat(p.initialValue),
        currentValue: parseFloat(p.currentValue),
        cashPnl: parseFloat(p.cashPnl),
        realizedPnl: parseFloat(p.realizedPnl),
        outcome: p.outcome,
        title: p.title || '',
        slug: p.slug || '',
        redeemable: p.redeemable === true,
      }));
  }

  /**
   * Fetch current positions from Polymarket Data API.
   * No authentication required.
   */
  async fetchPositions(): Promise<PolymarketPosition[]> {
    const url = `${this.baseUrl}/positions?user=${this.walletAddress}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) {
      throw new Error(`Data API positions error: ${res.status}`);
    }
    const data = await res.json();
    return this.mapRawPositions(data);
  }
}
