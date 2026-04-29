import WebSocket from 'ws';

/**
 * User WebSocket Stream — §3 (user_websocket)
 * Subscribes to own order updates, fill updates, position updates.
 */

export interface UserOrderUpdate {
  orderId: string;
  status: 'open' | 'filled' | 'cancelled' | 'partially_filled';
  filledSize?: number;
  remainingSize?: number;
  price?: number;
}

export interface UserFillUpdate {
  orderId: string;
  tokenId: string;
  side: 'BUY' | 'SELL';
  filledPrice: number;
  filledSize: number;
  makerFeeRate?: number;
}

export interface UserPositionUpdate {
  tokenId: string;
  balance: number;
}

export type UserStreamEvent =
  | { type: 'order'; data: UserOrderUpdate }
  | { type: 'fill'; data: UserFillUpdate }
  | { type: 'position'; data: UserPositionUpdate }
  | { type: 'connect' }
  | { type: 'disconnect' };

export type UserStreamHandler = (event: UserStreamEvent) => void;

export class WsUserStream {
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isConnected = false;
  private disconnectedAt: number | null = null;

  constructor(
    private url: string = 'wss://ws-subscriptions-clob.polymarket.com/ws/user',
    private apiKey: string,
    private onEvent: UserStreamHandler,
    private onError?: (err: Error) => void
  ) {}

  connect(): void {
    this.ws = new WebSocket(this.url);

    this.ws.on('open', () => {
      this.isConnected = true;
      this.disconnectedAt = null;
      console.log('[WS:User] Connected');
      this.subscribe();
      this.onEvent({ type: 'connect' });
    });

    this.ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handleMessage(msg);
      } catch {
        // ignore non-JSON
      }
    });

    this.ws.on('error', (err) => {
      console.error('[WS:User] Error:', err.message);
      this.onError?.(err);
    });

    this.ws.on('close', () => {
      this.isConnected = false;
      this.disconnectedAt = Date.now();
      console.log('[WS:User] Disconnected, reconnecting in 3s…');
      this.onEvent({ type: 'disconnect' });
      this.reconnectTimer = setTimeout(() => this.connect(), 3000);
    });
  }

  private subscribe(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'user', apiKey: this.apiKey }));
  }

  private handleMessage(msg: any): void {
    if (!msg || !msg.type) return;

    switch (msg.type) {
      case 'trade':
        this.onEvent({
          type: 'fill',
          data: {
            orderId: msg.order_id || '',
            tokenId: msg.asset_id || '',
            side: msg.side === 'BUY' ? 'BUY' : 'SELL',
            filledPrice: parseFloat(msg.price) || 0,
            filledSize: parseFloat(msg.size) || 0,
            makerFeeRate: parseFloat(msg.maker_fee_rate) || undefined,
          },
        });
        break;

      case 'order':
        this.onEvent({
          type: 'order',
          data: {
            orderId: msg.id || '',
            status: msg.status || 'open',
            filledSize: parseFloat(msg.size_matched) || 0,
            remainingSize: parseFloat(msg.size_remaining) || 0,
            price: parseFloat(msg.price) || undefined,
          },
        });
        break;
    }
  }

  disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
    this.isConnected = false;
  }

  getConnectionStatus(): { connected: boolean; disconnectedAt: number | null } {
    return { connected: this.isConnected, disconnectedAt: this.disconnectedAt };
  }
}
