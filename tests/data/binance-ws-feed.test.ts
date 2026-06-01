import { EventEmitter } from 'events';
import { BinanceWsFeed, PriceUpdate } from '../../src/data/binance-ws-feed';

const mockWsInstances: Array<{
  on: jest.Mock;
  close: jest.Mock;
  removeAllListeners: jest.Mock;
  emit: (event: string, ...args: unknown[]) => boolean;
  readyState?: number;
}> = [];

jest.mock('ws', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => {
    const emitter = new EventEmitter();
    const instance = {
      on: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
        emitter.on(event, cb);
      }),
      close: jest.fn(),
      removeAllListeners: jest.fn(() => {
        emitter.removeAllListeners();
      }),
      emit: (event: string, ...args: unknown[]) => emitter.emit(event, ...args),
      readyState: 1, // OPEN
    };
    mockWsInstances.push(instance);
    return instance;
  }),
}));

describe('BinanceWsFeed', () => {
  beforeEach(() => {
    mockWsInstances.length = 0;
    jest.useRealTimers();
  });

  it('should create feed with default config', () => {
    const feed = new BinanceWsFeed();
    expect(feed).toBeDefined();
    expect(feed.isConnected()).toBe(false);
  });

  it('should parse Binance kline message correctly', () => {
    const feed = new BinanceWsFeed();
    const message = {
      e: 'kline',
      E: 1234567890,
      s: 'BTCUSDT',
      k: {
        t: 1234567890000,
        T: 1234567890000,
        s: 'BTCUSDT',
        i: '1m',
        o: '50000.00',
        c: '50100.00',
        h: '50200.00',
        l: '49900.00',
        v: '100.00',
        n: 50,
        x: false
      }
    };

    const update = feed.parseMessage(message);
    expect(update).toEqual({
      symbol: 'BTCUSDT',
      price: 50100.00,
      timestamp: 1234567890000,
      volume: 100.00,
      high: 50200.00,
      low: 49900.00
    });
  });

  it('should return null for non-kline messages', () => {
    const feed = new BinanceWsFeed();
    const message = { e: 'other', data: 'test' };
    const update = feed.parseMessage(message);
    expect(update).toBeNull();
  });

  it('should return null for invalid input', () => {
    const feed = new BinanceWsFeed();
    expect(feed.parseMessage(null)).toBeNull();
    expect(feed.parseMessage(undefined)).toBeNull();
    expect(feed.parseMessage('not-json')).toBeNull();
    expect(feed.parseMessage(42)).toBeNull();
  });

  it('should return null for malformed kline payloads with non-finite numbers', () => {
    const feed = new BinanceWsFeed();
    const baseMessage = {
      e: 'kline',
      s: 'BTCUSDT',
      k: {
        t: 1700000000000,
        c: '50100.00',
        h: '50200.00',
        l: '49900.00',
        v: '100.00',
      },
    };

    expect(feed.parseMessage({ ...baseMessage, k: { ...baseMessage.k, c: 'not-a-number' } })).toBeNull();
    expect(feed.parseMessage({ ...baseMessage, k: { ...baseMessage.k, c: '' } })).toBeNull();
    expect(feed.parseMessage({ ...baseMessage, k: { ...baseMessage.k, c: '   ' } })).toBeNull();
    expect(feed.parseMessage({ ...baseMessage, k: { ...baseMessage.k, t: '' } })).toBeNull();
    expect(feed.parseMessage({ ...baseMessage, k: { ...baseMessage.k, h: undefined } })).toBeNull();
    expect(feed.parseMessage({ ...baseMessage, k: { ...baseMessage.k, l: null } })).toBeNull();
    expect(feed.parseMessage({ ...baseMessage, k: { ...baseMessage.k, v: 'NaN' } })).toBeNull();
    expect(feed.parseMessage({ ...baseMessage, s: '' })).toBeNull();
  });

  it('should accept custom config', () => {
    const onUpdate = jest.fn();
    const onError = jest.fn();
    const feed = new BinanceWsFeed({
      symbols: ['ethusdt'],
      onPriceUpdate: onUpdate,
      onError,
    });
    expect(feed.isConnected()).toBe(false);
  });

  it('should not reconnect after disconnect', () => {
    jest.useFakeTimers();

    const feed = new BinanceWsFeed({
      symbols: ['btcusdt'],
    });

    feed.connect();
    const ws = mockWsInstances[0];

    // Simulate 'open' event to set connected=true
    ws.emit('open');
    expect(feed.isConnected()).toBe(true);

    // Disconnect — this should remove listeners, close ws, and set stopped=true
    feed.disconnect();
    expect(feed.isConnected()).toBe(false);
    expect(ws.removeAllListeners).toHaveBeenCalled();
    expect(ws.close).toHaveBeenCalled();

    // Even if a 'close' event fires after removeAllListeners, it should not reconnect.
    ws.emit('close');

    // Advance time past any reconnect delay — no reconnect should happen
    jest.advanceTimersByTime(120_000);

    // If reconnect had happened, a new ws would have been created
    expect(mockWsInstances).toHaveLength(1);

    jest.useRealTimers();
  });

  it('should parse wrapped message (from multi-stream)', () => {
    const feed = new BinanceWsFeed();
    const inner = {
      e: 'kline',
      E: 9876543210,
      s: 'ETHUSDT',
      k: {
        t: 9876543210000,
        T: 9876543210000,
        s: 'ETHUSDT',
        i: '1m',
        o: '3000.00',
        c: '3050.00',
        h: '3100.00',
        l: '2950.00',
        v: '200.00',
        n: 80,
        x: false
      }
    };
    // When the message handler receives a wrapped multi-stream payload,
    // it extracts `message.data` before calling parseMessage.
    // parseMessage itself expects a raw kline object.
    const wrapped = { stream: 'ethusdt@kline_1m', data: inner };
    const update = feed.parseMessage(wrapped);
    expect(update).toBeNull(); // parseMessage only handles raw kline, not wrapped
  });

  // --- I-4: New test coverage ---

  it('should call onPriceUpdate when message received', () => {
    const onPriceUpdate = jest.fn();
    const feed = new BinanceWsFeed({ onPriceUpdate });
    feed.connect();

    const ws = mockWsInstances[0];
    ws.emit('open');
    expect(feed.isConnected()).toBe(true);

    const message = {
      e: 'kline',
      E: 1234567890,
      s: 'BTCUSDT',
      k: {
        t: 1234567890000,
        T: 1234567890000,
        s: 'BTCUSDT',
        i: '1m',
        o: '50000.00',
        c: '50100.00',
        h: '50200.00',
        l: '49900.00',
        v: '100.00',
        n: 50,
        x: false
      }
    };

    ws.emit('message', JSON.stringify(message));

    expect(onPriceUpdate).toHaveBeenCalledWith({
      symbol: 'BTCUSDT',
      price: 50100.00,
      timestamp: 1234567890000,
      volume: 100.00,
      high: 50200.00,
      low: 49900.00
    });
  });

  it('should call onPriceUpdate for wrapped multi-stream messages', () => {
    const onPriceUpdate = jest.fn();
    const feed = new BinanceWsFeed({ onPriceUpdate });
    feed.connect();

    const ws = mockWsInstances[0];
    ws.emit('open');

    const inner = {
      e: 'kline',
      E: 9876543210,
      s: 'ETHUSDT',
      k: {
        t: 9876543210000,
        T: 9876543210000,
        s: 'ETHUSDT',
        i: '1m',
        o: '3000.00',
        c: '3050.00',
        h: '3100.00',
        l: '2950.00',
        v: '200.00',
        n: 80,
        x: false
      }
    };

    ws.emit('message', JSON.stringify({ stream: 'ethusdt@kline_1m', data: inner }));

    expect(onPriceUpdate).toHaveBeenCalledWith({
      symbol: 'ETHUSDT',
      price: 3050.00,
      timestamp: 9876543210000,
      volume: 200.00,
      high: 3100.00,
      low: 2950.00
    });
  });

  it('should call onError when websocket errors', () => {
    const onError = jest.fn();
    const feed = new BinanceWsFeed({ onError });
    feed.connect();

    const ws = mockWsInstances[0];
    const error = new Error('Connection failed');
    ws.emit('error', error);

    expect(onError).toHaveBeenCalledWith(error);
  });

  it('should reconnect after unexpected close with exponential backoff', () => {
    jest.useFakeTimers();

    const feed = new BinanceWsFeed();
    feed.connect();

    const ws1 = mockWsInstances[0];
    ws1.emit('open');
    expect(feed.isConnected()).toBe(true);

    // Simulate unexpected close
    ws1.emit('close');
    expect(feed.isConnected()).toBe(false);

    // First reconnect delay: BASE(1000) * 2^0 + jitter(0..1000) = 1000..2000ms
    // Advance past the maximum possible first delay
    jest.advanceTimersByTime(2500);

    // Second ws should have been created
    expect(mockWsInstances.length).toBe(2);
    const ws2 = mockWsInstances[1];
    ws2.emit('open');
    expect(feed.isConnected()).toBe(true);

    // Second close — delay should be longer (attempt counter was reset by open)
    ws2.emit('close');
    expect(feed.isConnected()).toBe(false);

    jest.advanceTimersByTime(2500);
    expect(mockWsInstances.length).toBe(3);

    jest.useRealTimers();
  });

  it('should construct correct URL from symbols', () => {
    const feed = new BinanceWsFeed({ symbols: ['ethusdt', 'solusdt'] });
    feed.connect();

    // The mock captures the URL passed to the WebSocket constructor.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const wsModule = require('ws');
    const WsConstructor = wsModule.default as jest.Mock;
    expect(WsConstructor).toHaveBeenLastCalledWith(
      'wss://stream.binance.com:9443/stream?streams=ethusdt@kline_1m/solusdt@kline_1m'
    );
  });

  it('should use configured WebSocket base URL', () => {
    const feed = new BinanceWsFeed({
      symbols: ['btcusdt'],
      wsBaseUrl: 'wss://example.test:9443',
    });

    feed.connect();

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const wsModule = require('ws');
    const WsConstructor = wsModule.default as jest.Mock;
    expect(WsConstructor).toHaveBeenLastCalledWith(
      'wss://example.test:9443/stream?streams=btcusdt@kline_1m'
    );
  });

  it('should not schedule reconnect when stopped', () => {
    jest.useFakeTimers();

    const feed = new BinanceWsFeed();
    feed.connect();
    const ws = mockWsInstances[0];
    ws.emit('open');

    // Stop the feed
    feed.disconnect();

    // Manually trigger close (simulating late close event)
    ws.emit('close');

    jest.advanceTimersByTime(120_000);

    // Only 1 ws instance — no reconnect
    expect(mockWsInstances).toHaveLength(1);

    jest.useRealTimers();
  });

  it('should clean up previous ws when connect() called twice', () => {
    const feed = new BinanceWsFeed();
    feed.connect();
    const ws1 = mockWsInstances[0];
    ws1.emit('open');

    // Call connect again without disconnecting first
    feed.connect();
    const ws2 = mockWsInstances[1];

    // First ws should have been cleaned up
    expect(ws1.removeAllListeners).toHaveBeenCalled();
    expect(ws1.close).toHaveBeenCalled();

    // Second ws should be active
    ws2.emit('open');
    expect(feed.isConnected()).toBe(true);
  });
});
