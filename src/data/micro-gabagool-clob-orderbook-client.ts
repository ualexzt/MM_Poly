export interface MicroGabagoolTopOfBook {
  bestBid: number;
  bestAsk: number;
  bestBidSizeUsd: number;
  bestAskSizeUsd: number;
}

export interface MicroGabagoolClobOrderbookClientConfig {
  baseUrl: string;
  fetchFn?: typeof fetch;
}

interface BookLevel {
  price: number;
  size: number;
  sizeUsd: number;
}

function parseNumeric(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseLevels(levels: unknown): BookLevel[] {
  if (!Array.isArray(levels)) {
    return [];
  }

  return levels.flatMap((level) => {
    if (typeof level !== 'object' || level === null) {
      return [];
    }

    const rawLevel = level as { price?: unknown; size?: unknown };
    const price = parseNumeric(rawLevel.price);
    const size = parseNumeric(rawLevel.size);
    if (price === null || size === null) {
      return [];
    }

    return [{ price, size, sizeUsd: price * size }];
  });
}

export class MicroGabagoolClobOrderbookClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(config: MicroGabagoolClobOrderbookClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.fetchFn = config.fetchFn ?? fetch;
  }

  async getTopOfBook(tokenId: string): Promise<MicroGabagoolTopOfBook | null> {
    const response = await this.fetchFn(`${this.baseUrl}/book?token_id=${encodeURIComponent(tokenId)}`);
    if (!response.ok) {
      throw new Error(`CLOB API error: ${response.status}`);
    }

    const payload = await response.json() as { bids?: unknown; asks?: unknown };
    const bids = parseLevels(payload.bids).sort((a, b) => b.price - a.price);
    const asks = parseLevels(payload.asks).sort((a, b) => a.price - b.price);

    const bestBid = bids[0];
    const bestAsk = asks[0];
    if (!bestBid || !bestAsk) {
      return null;
    }

    return {
      bestBid: bestBid.price,
      bestAsk: bestAsk.price,
      bestBidSizeUsd: bestBid.sizeUsd,
      bestAskSizeUsd: bestAsk.sizeUsd,
    };
  }
}
