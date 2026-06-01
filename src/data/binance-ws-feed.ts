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
  wsBaseUrl: string;
  onPriceUpdate: (update: PriceUpdate) => void;
  onError: (error: Error) => void;
}

const DEFAULT_CONFIG: BinanceWsFeedConfig = {
  symbols: ['btcusdt', 'ethusdt'],
  wsBaseUrl: 'wss://stream.binance.com:9443',
  onPriceUpdate: () => {},
  onError: () => {},
};

function finiteNumberFromString(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

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
    const baseUrl = this.config.wsBaseUrl.replace(/\/$/, '');
    const url = `${baseUrl}/stream?streams=${streams}`;

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
      if (m.e !== 'kline' || typeof m.k !== 'object' || m.k === null) return null;

      const symbol = nonEmptyString(m.s);
      if (!symbol) return null;

      const k = m.k as Record<string, unknown>;
      const price = finiteNumberFromString(k.c);
      const timestamp = finiteNumberFromString(k.t);
      const volume = finiteNumberFromString(k.v);
      const high = finiteNumberFromString(k.h);
      const low = finiteNumberFromString(k.l);

      if (
        price === null ||
        timestamp === null ||
        volume === null ||
        high === null ||
        low === null
      ) {
        return null;
      }

      return { symbol, price, timestamp, volume, high, low };
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
