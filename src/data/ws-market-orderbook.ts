import WebSocket from 'ws';
import { BookState, BookLevel } from '../types/book';

export interface WsMarketConfig {
  url?: string;
  pingIntervalMs?: number;
  reconnectDelayMs?: number;
}

const DEFAULT_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
const DEFAULT_PING_MS = 10_000;
const DEFAULT_RECONNECT_MS = 3_000;

export function mapClobBookFromWs(data: any): BookState {
  const tokenId = data.asset_id as string;
  const conditionId = data.market as string;

  const bids: BookLevel[] = (data.bids || []).map((b: any) => ({
    price: parseFloat(b.price),
    size: parseFloat(b.size),
    sizeUsd: parseFloat(b.price) * parseFloat(b.size),
  })).sort((a: BookLevel, b: BookLevel) => b.price - a.price);

  const asks: BookLevel[] = (data.asks || []).map((a: any) => ({
    price: parseFloat(a.price),
    size: parseFloat(a.size),
    sizeUsd: parseFloat(a.price) * parseFloat(a.size),
  })).sort((a: BookLevel, b: BookLevel) => a.price - b.price);

  const bestBid = bids.length > 0 ? bids[0].price : null;
  const bestAsk = asks.length > 0 ? asks[0].price : null;
  const midpoint = bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : null;
  const spread = bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;

  return {
    tokenId,
    conditionId,
    bids,
    asks,
    bestBid,
    bestAsk,
    bestBidSizeUsd: bids.length > 0 ? bids[0].sizeUsd : 0,
    bestAskSizeUsd: asks.length > 0 ? asks[0].sizeUsd : 0,
    midpoint,
    spread,
    spreadTicks: spread !== null ? Math.round(spread / 0.01) : null,
    depth1Usd: (bids[0]?.sizeUsd || 0) + (asks[0]?.sizeUsd || 0),
    depth3Usd: bids.slice(0, 3).reduce((s, b) => s + b.sizeUsd, 0) + asks.slice(0, 3).reduce((s, a) => s + a.sizeUsd, 0),
    tickSize: 0.01,
    minOrderSize: 1,
    orderbookHash: data.hash || null,
    lastUpdateMs: Date.now(),
  };
}

export class WsMarketOrderbookClient {
  private ws: WebSocket | null = null;
  private books = new Map<string, BookState>();
  private subscribedIds = new Set<string>();
  private config: Required<WsMarketConfig>;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  public onBookUpdate?: (tokenId: string, book: BookState) => void;

  constructor(config: WsMarketConfig = {}) {
    this.config = {
      url: config.url ?? DEFAULT_URL,
      pingIntervalMs: config.pingIntervalMs ?? DEFAULT_PING_MS,
      reconnectDelayMs: config.reconnectDelayMs ?? DEFAULT_RECONNECT_MS,
    };
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.config.url);

      this.ws.on('open', () => {
        resolve();
        this.startPing();
        this.resubscribe();
      });

      this.ws.on('error', (err: Error) => {
        reject(err);
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        this.handleMessage(data);
      });

      this.ws.on('close', () => {
        this.stopPing();
        if (!this.closed) {
          this.scheduleReconnect();
        }
      });
    });
  }

  subscribe(assetIds: string[]): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const newIds = assetIds.filter(id => !this.subscribedIds.has(id));
      if (newIds.length > 0) {
        const alreadySubscribed = this.subscribedIds.size > 0;
        if (alreadySubscribed) {
          this.ws.send(JSON.stringify({
            operation: 'subscribe',
            assets_ids: newIds,
          }));
        } else {
          this.ws.send(JSON.stringify({
            assets_ids: assetIds,
            type: 'market',
          }));
        }
      }
    }
    for (const id of assetIds) {
      this.subscribedIds.add(id);
    }
  }

  getBook(tokenId: string): BookState | null {
    return this.books.get(tokenId) ?? null;
  }

  close(): void {
    this.closed = true;
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private resubscribe(): void {
    if (this.subscribedIds.size > 0 && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        assets_ids: [...this.subscribedIds],
        type: 'market',
      }));
    }
  }

  private handleMessage(data: WebSocket.Data): void {
    try {
      const msg = JSON.parse(data.toString());
      switch (msg.event_type) {
        case 'book':
          this.handleBook(msg);
          break;
        case 'price_change':
          this.handlePriceChange(msg);
          break;
        // Other event types (last_trade_price, tick_size_change, best_bid_ask) ignored for now
      }
    } catch {
      // Ignore unparseable messages (e.g., PONG text or corrupted JSON)
    }
  }

  private handleBook(data: any): void {
    const book = mapClobBookFromWs(data);
    this.books.set(book.tokenId, book);
    if (this.onBookUpdate) {
      this.onBookUpdate(book.tokenId, book);
    }
  }

  private handlePriceChange(data: any): void {
    if (!data.price_changes) return;

    for (const change of data.price_changes) {
      const assetId = change.asset_id as string;
      const book = this.books.get(assetId);
      if (!book) continue;

      const price = parseFloat(change.price);
      const size = parseFloat(change.size);
      const side = change.side as string;
      const levels = side === 'BUY' ? book.bids : book.asks;

      if (size === 0) {
        // Remove level
        const idx = levels.findIndex(l => l.price === price);
        if (idx >= 0) levels.splice(idx, 1);
      } else {
        // Upsert level
        const existing = levels.find(l => l.price === price);
        if (existing) {
          existing.size = size;
          existing.sizeUsd = price * size;
        } else {
          levels.push({ price, size, sizeUsd: price * size });
          levels.sort((a, b) => side === 'BUY' ? b.price - a.price : a.price - b.price);
        }
      }

      // Recalculate book stats
      if (book.bids.length > 0) {
        book.bestBid = book.bids[0].price;
        book.bestBidSizeUsd = book.bids[0].sizeUsd;
      } else {
        book.bestBid = null;
        book.bestBidSizeUsd = 0;
      }

      if (book.asks.length > 0) {
        book.bestAsk = book.asks[0].price;
        book.bestAskSizeUsd = book.asks[0].sizeUsd;
      } else {
        book.bestAsk = null;
        book.bestAskSizeUsd = 0;
      }

      if (book.bestBid !== null && book.bestAsk !== null) {
        book.midpoint = (book.bestBid + book.bestAsk) / 2;
        book.spread = book.bestAsk - book.bestBid;
      } else {
        book.midpoint = null;
        book.spread = null;
      }

      book.depth1Usd = (book.bids[0]?.sizeUsd || 0) + (book.asks[0]?.sizeUsd || 0);
      book.depth3Usd = book.bids.slice(0, 3).reduce((s, b) => s + b.sizeUsd, 0) + book.asks.slice(0, 3).reduce((s, a) => s + a.sizeUsd, 0);
      book.lastUpdateMs = Date.now();
    }
  }

  private startPing(): void {
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send('PING');
      }
    }, this.config.pingIntervalMs);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closed) {
        this.connect().catch(() => {
          // Failed to reconnect — will retry on next close
        });
      }
    }, this.config.reconnectDelayMs);
  }
}
