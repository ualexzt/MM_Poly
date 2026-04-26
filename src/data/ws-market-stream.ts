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
    });

    this.ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handleMessage(msg);
      } catch (err) {
        console.error('[WS] Parse error:', err);
      }
    });

    this.ws.on('error', (err) => {
      console.error('[WS] Error:', err.message);
      this.onError?.(err);
    });

    this.ws.on('close', () => {
      this.isConnected = false;
      console.log('[WS] Disconnected, reconnecting in 5s...');
      this.reconnectTimer = setTimeout(() => this.connect(this.tokenIds), 5000);
    });
  }

  private subscribe(tokenIds: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    for (const id of tokenIds) {
      this.ws.send(JSON.stringify({ type: 'market', assets_ids: [id] }));
    }
  }

  private handleMessage(msg: any): void {
    if (msg.event_type === 'book' && msg.asset_id) {
      const book = this.mapBook(msg.payload, msg.asset_id);
      this.onUpdate({ tokenId: msg.asset_id, book, lastTradePrice: null, eventType: 'book', timestamp: Date.now() });
    } else if (msg.event_type === 'price_change' && msg.asset_id) {
      this.onUpdate({ tokenId: msg.asset_id, book: null, lastTradePrice: parseFloat(msg.price) || null, eventType: 'tick', timestamp: Date.now() });
    } else if (msg.event_type === 'trade' && msg.asset_id) {
      this.onUpdate({ tokenId: msg.asset_id, book: null, lastTradePrice: parseFloat(msg.price) || null, eventType: 'trade', timestamp: Date.now() });
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
      conditionId: '',
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
