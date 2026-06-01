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
  onPriceUpdate: (update: PriceUpdate) => void;
  onError: (error: Error) => void;
}

const DEFAULT_CONFIG: BinanceWsFeedConfig = {
  symbols: ['btcusdt', 'ethusdt'],
  onPriceUpdate: () => {},
  onError: () => {},
};

export class BinanceWsFeed {
  private ws: WebSocket | null = null;
  private config: BinanceWsFeedConfig;
  private connected: boolean = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped: boolean = false;
  private reconnectAttempt: number = 0;

  private readonly BASE_RECONNECT_DELAY_MS = 1_000;
  private readonly MAX_RECONNECT_DELAY_MS = 60_000;

  constructor(config: Partial<BinanceWsFeedConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  isConnected(): boolean {
    return this.connected;
  }

  connect(): void {
    if (this.ws) {
      this.disconnect();
    }
    this.stopped = false;
    const streams = this.config.symbols.map((s) => `${s}@kline_1m`).join('/');
    const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;

    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      this.connected = true;
      this.reconnectAttempt = 0;
      console.log('[BinanceWsFeed] Connected');
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const message = JSON.parse(data.toString());
        const payload = message.data || message;
        const update = this.parseMessage(payload);
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

  parseMessage(msg: unknown): PriceUpdate | null {
    try {
      if (typeof msg !== 'object' || msg === null) return null;
      const m = msg as Record<string, unknown>;
      if (m.e !== 'kline' || !m.k) return null;

      const k = m.k as Record<string, string>;
      return {
        symbol: m.s as string,
        price: parseFloat(k.c),
        timestamp: k.t as unknown as number,
        volume: parseFloat(k.v),
        high: parseFloat(k.h),
        low: parseFloat(k.l),
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

    const delay = Math.min(
      this.BASE_RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempt) + Math.random() * 1000,
      this.MAX_RECONNECT_DELAY_MS
    );
    this.reconnectAttempt++;
    console.log(`[BinanceWsFeed] Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempt})...`);
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }
}
