import { EventEmitter } from 'events';
import { WsMarketOrderbookClient, mapClobBookFromWs } from '../../src/data/ws-market-orderbook';

// Class used by the mock factory
class MockWebSocket extends EventEmitter {
  readyState = 0;
  send = jest.fn();
  url: string;

  constructor(url: string) {
    super();
    this.url = url;
  }

  close() {
    this.readyState = 3;
    this.emit('close', 1000, 'manual');
  }
}

// Must use var so jest.mock factory accesses it before hoisted let is initialized
var mockWsCtor: jest.Mock<MockWebSocket>;

jest.mock('ws', () => {
  mockWsCtor = jest.fn((url: string) => new MockWebSocket(url));
  (mockWsCtor as any).OPEN = 1;
  return {
    __esModule: true,
    default: mockWsCtor,
  };
});

function createBookEvent(overrides: Partial<{
  asset_id: string;
  market: string;
  bids: Array<{ price: string; size: string }>;
  asks: Array<{ price: string; size: string }>;
  hash: string;
  timestamp: string;
}> = {}): object {
  return {
    event_type: 'book',
    asset_id: overrides.asset_id ?? 'yes-1',
    market: overrides.market ?? 'cid-1',
    bids: overrides.bids ?? [{ price: '0.42', size: '20' }, { price: '0.41', size: '10' }],
    asks: overrides.asks ?? [{ price: '0.52', size: '25' }, { price: '0.53', size: '15' }],
    hash: overrides.hash ?? '0xabc',
    timestamp: overrides.timestamp ?? '1000000',
  };
}

function createPriceChangeEvent(overrides: Partial<{
  market: string;
  price_changes: Array<{
    asset_id: string;
    price: string;
    size: string;
    side: string;
    hash: string;
    best_bid?: string;
    best_ask?: string;
  }>;
  timestamp: string;
}> = {}): object {
  return {
    event_type: 'price_change',
    market: overrides.market ?? 'cid-1',
    price_changes: overrides.price_changes ?? [
      { asset_id: 'yes-1', price: '0.43', size: '30', side: 'SELL', hash: '0x111' },
    ],
    timestamp: overrides.timestamp ?? '1000001',
  };
}

function lastWs(): MockWebSocket {
  return mockWsCtor!.mock.results[mockWsCtor!.mock.results.length - 1]!.value as MockWebSocket;
}

describe('WsMarketOrderbookClient', () => {
  let client: WsMarketOrderbookClient;

  beforeEach(() => {
    mockWsCtor?.mockClear();
    client = new WsMarketOrderbookClient({
      url: 'wss://test/ws/market',
      pingIntervalMs: 1000,
      reconnectDelayMs: 100,
    });
  });

  afterEach(() => {
    client.close();
  });

  describe('connect and subscribe', () => {
    it('connects and sends subscription', async () => {
      const connectPromise = client.connect();
      const ws = lastWs();
      ws.readyState = 1; // OPEN
      ws.emit('open');
      await connectPromise;

      client.subscribe(['yes-1', 'no-1']);
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({
        assets_ids: ['yes-1', 'no-1'],
        type: 'market',
      }));
    });

    it('rejects on connection error', async () => {
      const connectPromise = client.connect();
      const ws = lastWs();
      ws.emit('error', new Error('connection refused'));
      await expect(connectPromise).rejects.toThrow('connection refused');
    });
  });

  describe('book event handling', () => {
    let ws: MockWebSocket;

    beforeEach(async () => {
      const connectPromise = client.connect();
      ws = lastWs();
      ws.readyState = 1;
      ws.emit('open');
      await connectPromise;
      client.subscribe(['yes-1', 'no-1']);
    });

    it('stores book snapshot from book event', () => {
      const bookData = createBookEvent({
        asset_id: 'yes-1',
        bids: [{ price: '0.48', size: '30' }, { price: '0.47', size: '20' }],
        asks: [{ price: '0.52', size: '25' }],
      });
      ws.emit('message', JSON.stringify(bookData));

      const book = client.getBook('yes-1');
      expect(book).not.toBeNull();
      expect(book!.bestBid).toBe(0.48);
      expect(book!.bestAsk).toBe(0.52);
      expect(book!.bids).toHaveLength(2);
      expect(book!.asks).toHaveLength(1);
    });

    it('fires onBookUpdate callback', () => {
      const callback = jest.fn();
      client.onBookUpdate = callback;

      ws.emit('message', JSON.stringify(createBookEvent({ asset_id: 'no-1' })));

      expect(callback).toHaveBeenCalledWith('no-1', expect.objectContaining({
        tokenId: 'no-1',
        conditionId: 'cid-1',
      }));
    });

    it('returns null for unknown token', () => {
      expect(client.getBook('unknown')).toBeNull();
    });
  });

  describe('price_change event handling', () => {
    let ws: MockWebSocket;

    beforeEach(async () => {
      const connectPromise = client.connect();
      ws = lastWs();
      ws.readyState = 1;
      ws.emit('open');
      await connectPromise;
      client.subscribe(['yes-1']);
    });

    it('updates price level from price_change event', () => {
      ws.emit('message', JSON.stringify(createBookEvent({
        asset_id: 'yes-1',
        asks: [{ price: '0.52', size: '25' }],
      })));

      ws.emit('message', JSON.stringify(createPriceChangeEvent({
        price_changes: [{ asset_id: 'yes-1', price: '0.52', size: '40', side: 'SELL', hash: '0x222' }],
      })));

      const book = client.getBook('yes-1');
      const askLevel = book!.asks.find(a => a.price === 0.52);
      expect(askLevel).toBeDefined();
      expect(askLevel!.size).toBe(40);
    });

    it('removes price level when size is 0', () => {
      ws.emit('message', JSON.stringify(createBookEvent({
        asset_id: 'yes-1',
        asks: [{ price: '0.52', size: '25' }, { price: '0.53', size: '10' }],
      })));

      ws.emit('message', JSON.stringify(createPriceChangeEvent({
        price_changes: [{ asset_id: 'yes-1', price: '0.53', size: '0', side: 'SELL', hash: '0x333' }],
      })));

      const book = client.getBook('yes-1');
      expect(book!.asks.find(a => a.price === 0.53)).toBeUndefined();
    });

    it('adds new price level from price_change', () => {
      ws.emit('message', JSON.stringify(createBookEvent({
        asset_id: 'yes-1',
        asks: [{ price: '0.52', size: '25' }],
      })));

      ws.emit('message', JSON.stringify(createPriceChangeEvent({
        price_changes: [{ asset_id: 'yes-1', price: '0.53', size: '15', side: 'SELL', hash: '0x444' }],
      })));

      const book = client.getBook('yes-1');
      const newLevel = book!.asks.find(a => a.price === 0.53);
      expect(newLevel).toBeDefined();
      expect(newLevel!.size).toBe(15);
    });

    it('handles BUY side price changes', () => {
      ws.emit('message', JSON.stringify(createBookEvent({
        asset_id: 'yes-1',
        bids: [{ price: '0.48', size: '30' }],
      })));

      ws.emit('message', JSON.stringify(createPriceChangeEvent({
        price_changes: [{ asset_id: 'yes-1', price: '0.48', size: '50', side: 'BUY', hash: '0x555' }],
      })));

      const book = client.getBook('yes-1');
      expect(book!.bids[0].size).toBe(50);
    });
  });

  describe('reconnect', () => {
    it('reconnects on close and resubscribes', async () => {
      const connectPromise = client.connect();
      let ws = lastWs();
      ws.readyState = 1;
      ws.emit('open');
      await connectPromise;
      client.subscribe(['yes-1']);

      jest.useFakeTimers();

      // Close connection
      ws.readyState = 3;
      ws.emit('close', 1006, 'abnormal');

      // Advance past reconnect delay
      jest.advanceTimersByTime(200);

      // A new WebSocket should be created by reconnect
      const newWs = lastWs();
      expect(newWs).not.toBe(ws);
      expect(newWs.url).toBe('wss://test/ws/market');

      // Simulate successful reconnect
      newWs.readyState = 1;
      newWs.emit('open');

      // Should have resent subscription
      expect(newWs.send).toHaveBeenCalledWith(JSON.stringify({
        assets_ids: ['yes-1'],
        type: 'market',
      }));

      jest.useRealTimers();
    });
  });

  describe('close', () => {
    it('closes WebSocket and stops reconnecting', async () => {
      const connectPromise = client.connect();
      const ws = lastWs();
      ws.readyState = 1;
      ws.emit('open');
      await connectPromise;

      const closeSpy = jest.spyOn(ws, 'close');
      jest.useFakeTimers();
      client.close();
      jest.advanceTimersByTime(1000);

      expect(closeSpy).toHaveBeenCalled();
      // No additional WebSocket created
      expect(mockWsCtor!).toHaveBeenCalledTimes(1);
      jest.useRealTimers();
    });
  });

  describe('subscribe update', () => {
    it('sends subscription update when new assets are added', async () => {
      const connectPromise = client.connect();
      const ws = lastWs();
      ws.readyState = 1;
      ws.emit('open');
      await connectPromise;
      client.subscribe(['yes-1']);
      ws.send.mockClear();

      client.subscribe(['no-1']);

      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({
        operation: 'subscribe',
        assets_ids: ['no-1'],
      }));
    });
  });
});

describe('mapClobBookFromWs', () => {
  it('maps WebSocket book event to BookState', () => {
    const event = createBookEvent({
      asset_id: 'yes-1',
      market: 'cid-1',
      bids: [{ price: '0.48', size: '30' }, { price: '0.47', size: '20' }],
      asks: [{ price: '0.52', size: '25' }, { price: '0.53', size: '15' }],
      hash: '0xdeadbeef',
      timestamp: '1757908892351',
    });

    const state = mapClobBookFromWs(event as any);

    expect(state.tokenId).toBe('yes-1');
    expect(state.conditionId).toBe('cid-1');
    expect(state.bestBid).toBe(0.48);
    expect(state.bestAsk).toBe(0.52);
    expect(state.midpoint).toBeCloseTo(0.50, 2);
    expect(state.spread).toBeCloseTo(0.04, 2);
    expect(state.bids).toHaveLength(2);
    expect(state.asks).toHaveLength(2);
    expect(state.orderbookHash).toBe('0xdeadbeef');
    expect(state.lastUpdateMs).toBeGreaterThan(0);
  });
});
