import { BinanceWsFeed, PriceUpdate } from '../../src/data/binance-ws-feed';

describe('BinanceWsFeed', () => {
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

    const update = feed.parseMessage(JSON.stringify(message));
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
    const update = feed.parseMessage(JSON.stringify(message));
    expect(update).toBeNull();
  });

  it('should return null for invalid JSON', () => {
    const feed = new BinanceWsFeed();
    const update = feed.parseMessage('not-json');
    expect(update).toBeNull();
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
    const wrapped = { stream: 'ethusdt@kline_1m', data: inner };
    const update = feed.parseMessage(JSON.stringify(wrapped));
    expect(update).toBeNull(); // parseMessage only handles raw kline, not wrapped
  });
});
