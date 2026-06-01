import WebSocket from 'ws';

export interface PriceUpdate {
  symbol: string;
  price: number;
  timestamp: number;
  volume: number;
  high: number;
  low: number;
}

export interface BinanceWsFeedConfig {
  symbols: string[];
  reconnectIntervalMs: number;
  onPriceUpdate: (update: PriceUpdate) => void;
  onError: (error: Error) => void;
}

const DEFAULT_CONFIG: BinanceWsFeedConfig = {
  symbols: ['btcusdt', 'ethusdt'],
  reconnectIntervalMs: 5000,
  onPriceUpdate: () => {},
  onError: () => {},
};

export class BinanceWsFeed {
  private ws: WebSocket | null = null;
  private config: BinanceWsFeedConfig;
  private connected: boolean = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped: boolean = false;

  constructor(config: Partial<BinanceWsFeedConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  isConnected(): boolean {
    return this.connected;
  }

  connect(): void {
    this.stopped = false;
    const streams = this.config.symbols.map((s) => `${s}@kline_1m`).join('/');
    const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;

    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      this.connected = true;
      console.log('[BinanceWsFeed] Connected');
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const message = JSON.parse(data.toString());
        const payload = message.data || message;
        const update = this.parseMessage(JSON.stringify(payload));
        if (update) {
          this.config.onPriceUpdate(update);
        }
      } catch (err) {
        this.config.onError(err as Error);
      }
    });

    this.ws.on('close', () => {
      this.connected = false;
      console.log('[BinanceWsFeed] Disconnected, reconnecting...');
      this.scheduleReconnect();
    });

    this.ws.on('error', (err: Error) => {
      this.config.onError(err);
    });
  }

  parseMessage(data: string): PriceUpdate | null {
    try {
      const msg = JSON.parse(data);
      if (msg.e !== 'kline' || !msg.k) return null;

      return {
        symbol: msg.s,
        price: parseFloat(msg.k.c),
        timestamp: msg.k.t,
        volume: parseFloat(msg.k.v),
        high: parseFloat(msg.k.h),
        low: parseFloat(msg.k.l),
      };
    } catch {
      return null;
    }
  }

  disconnect(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, this.config.reconnectIntervalMs);
  }
}
