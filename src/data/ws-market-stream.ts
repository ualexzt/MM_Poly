import WebSocket from 'ws';
import { BookState, BookLevel } from '../types/book';

export interface WsMarketUpdate {
  tokenId: string;
  book: BookState | null;
  lastTradePrice: number | null;
  eventType: 'book' | 'trade' | 'tick' | 'connect' | 'disconnect';
  timestamp: number;
}

export type MarketUpdateHandler = (update: WsMarketUpdate) => void;

export class WsMarketStream {
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private tokenIds: string[] = [];
  private isConnected = false;
  private pingTimer: NodeJS.Timeout | null = null;

  constructor(
    private url: string = 'wss://ws-subscriptions-clob.polymarket.com/ws/market',
    private onUpdate: MarketUpdateHandler,
    private onError?: (err: Error) => void
  ) {}

  connect(tokenIds: string[]): void {
    this.tokenIds = tokenIds;
    this.ws = new WebSocket(this.url);

    this.ws.on('open', () => {
      this.isConnected = true;
      console.log('[WS] Market stream connected');
      this.subscribe(tokenIds);
      this.startPing();
    });

    this.ws.on('message', (data: Buffer) => {
      const dataStr = data.toString();
      if (dataStr === 'PONG') return;

      try {
        const msg = JSON.parse(dataStr);
        this.handleMessage(msg);
      } catch {
        // Ignore non-JSON messages (e.g., server errors)
      }
    });

    this.ws.on('error', (err) => {
      console.error('[WS] Error:', err.message);
      this.onError?.(err);
    });

    this.ws.on('close', () => {
      this.isConnected = false;
      this.stopPing();
      console.log('[WS] Disconnected, reconnecting in 5s...');
      this.reconnectTimer = setTimeout(() => this.connect(this.tokenIds), 5000);
    });
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws && this.isConnected) {
        this.ws.send('PING');
      }
    }, 20000); // 20s interval
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private subscribe(tokenIds: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    for (const id of tokenIds) {
      this.ws.send(JSON.stringify({ type: 'market', assets_ids: [id] }));
    }
  }

  private handleMessage(msg: any): void {
    // Book snapshot (array of books)
    if (Array.isArray(msg)) {
      for (const bookMsg of msg) {
        if (bookMsg.asset_id && bookMsg.bids) {
          const book = this.mapBook(bookMsg, bookMsg.asset_id);
          this.onUpdate({ tokenId: bookMsg.asset_id, book, lastTradePrice: null, eventType: 'book', timestamp: Date.now() });
        }
      }
      return;
    }

    // Price change / tick update (incremental book update)
    if (msg.price_changes && Array.isArray(msg.price_changes)) {
      for (const change of msg.price_changes) {
        const bestBid = change.best_bid != null ? parseFloat(change.best_bid) : null;
        const bestAsk = change.best_ask != null ? parseFloat(change.best_ask) : null;
        const midpoint = bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : null;
        const spread = bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;
        this.onUpdate({
          tokenId: change.asset_id,
          book: {
            tokenId: change.asset_id,
            conditionId: msg.market || '',
            bids: bestBid !== null ? [{ price: bestBid, size: parseFloat(change.size) || 0, sizeUsd: bestBid * (parseFloat(change.size) || 0) }] : [],
            asks: bestAsk !== null ? [{ price: bestAsk, size: parseFloat(change.size) || 0, sizeUsd: bestAsk * (parseFloat(change.size) || 0) }] : [],
            bestBid,
            bestAsk,
            bestBidSizeUsd: bestBid !== null ? bestBid * (parseFloat(change.size) || 0) : 0,
            bestAskSizeUsd: bestAsk !== null ? bestAsk * (parseFloat(change.size) || 0) : 0,
            midpoint,
            spread,
            spreadTicks: spread !== null ? Math.round(spread / 0.01) : null,
            depth1Usd: (bestBid !== null ? bestBid * (parseFloat(change.size) || 0) : 0) + (bestAsk !== null ? bestAsk * (parseFloat(change.size) || 0) : 0),
            depth3Usd: (bestBid !== null ? bestBid * (parseFloat(change.size) || 0) : 0) + (bestAsk !== null ? bestAsk * (parseFloat(change.size) || 0) : 0),
            tickSize: 0.01,
            minOrderSize: 1,
            orderbookHash: change.hash || null,
            lastUpdateMs: Date.now()
          },
          lastTradePrice: parseFloat(change.price) || null,
          eventType: 'tick',
          timestamp: Date.now()
        });
      }
      return;
    }

    // Single book update
    if (msg.asset_id && msg.bids) {
      const book = this.mapBook(msg, msg.asset_id);
      this.onUpdate({ tokenId: msg.asset_id, book, lastTradePrice: null, eventType: 'book', timestamp: Date.now() });
    }
  }

  private mapBook(payload: any, tokenId: string): BookState {
    const bids: BookLevel[] = (payload.bids || []).map((b: any) => ({
      price: parseFloat(b.price),
      size: parseFloat(b.size),
      sizeUsd: parseFloat(b.price) * parseFloat(b.size)
    }));
    const asks: BookLevel[] = (payload.asks || []).map((a: any) => ({
      price: parseFloat(a.price),
      size: parseFloat(a.size),
      sizeUsd: parseFloat(a.price) * parseFloat(a.size)
    }));

    const bestBid = bids.length > 0 ? bids[0].price : null;
    const bestAsk = asks.length > 0 ? asks[0].price : null;
    const midpoint = bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : null;
    const spread = bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;

    return {
      tokenId,
      conditionId: payload.market || '',
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
      orderbookHash: payload.hash || null,
      lastUpdateMs: Date.now()
    };
  }

  disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
    this.isConnected = false;
  }
}
