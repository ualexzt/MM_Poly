import { MarketState } from '../../src/types/market';
import { BookState } from '../../src/types/book';
import { PairCostConfig, PairCostOpportunity } from '../../src/engines/pair-cost-scanner';
import {
  fetchPairOrderbooks,
  runPairCostScanCycle,
} from '../../src/strategy/pair-cost-runner';

const DEFAULT_CONFIG: PairCostConfig = {
  maxPairCost: 0.99,
  minEdgeBps: 50,
  minLiquidityUsd: 10,
  feeRate: 0.02,
};

function makeMarket(overrides: Partial<MarketState> = {}): MarketState {
  return {
    conditionId: 'cid-1',
    slug: 'test-market',
    question: 'Will X happen?',
    yesTokenId: 'yes-1',
    noTokenId: 'no-1',
    active: true,
    closed: false,
    enableOrderBook: true,
    feesEnabled: true,
    volume24hUsd: 1000,
    liquidityUsd: 500,
    oracleAmbiguityScore: 0.05,
    feeRate: 0.02,
    ...overrides,
  };
}

function makeBook(overrides: Partial<BookState> = {}): BookState {
  return {
    tokenId: 'token-1',
    conditionId: 'cid-1',
    bids: [],
    asks: [],
    bestBid: null,
    bestAsk: null,
    bestBidSizeUsd: 0,
    bestAskSizeUsd: 0,
    midpoint: null,
    spread: null,
    spreadTicks: null,
    depth1Usd: 0,
    depth3Usd: 0,
    tickSize: 0.01,
    minOrderSize: 1,
    lastUpdateMs: Date.now(),
    ...overrides,
  };
}

describe('fetchPairOrderbooks', () => {
  it('returns empty map when no markets provided', async () => {
    const client = { fetchBook: jest.fn() };
    const result = await fetchPairOrderbooks(client, []);
    expect(result.size).toBe(0);
  });

  it('fetches YES and NO books for each market', async () => {
    const yesBook = makeBook({ tokenId: 'yes-1', bestAsk: 0.45 });
    const noBook = makeBook({ tokenId: 'no-1', bestAsk: 0.48 });
    const client = { fetchBook: jest.fn().mockResolvedValueOnce(yesBook).mockResolvedValueOnce(noBook) };
    const markets = [makeMarket()];

    const result = await fetchPairOrderbooks(client, markets);
    expect(result.size).toBe(1);
    expect(result.get('cid-1')).toEqual({ yes: yesBook, no: noBook });
    expect(client.fetchBook).toHaveBeenCalledTimes(2);
    expect(client.fetchBook).toHaveBeenCalledWith('cid-1', 'yes-1');
    expect(client.fetchBook).toHaveBeenCalledWith('cid-1', 'no-1');
  });

  it('skips market when fetch fails', async () => {
    const client = { fetchBook: jest.fn().mockRejectedValueOnce(new Error('timeout')) };
    const markets = [makeMarket()];
    const onError = jest.fn();

    const result = await fetchPairOrderbooks(client, markets, { onError });
    expect(result.size).toBe(0);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'timeout' }));
  });
});

describe('runPairCostScanCycle', () => {
  it('logs opportunities found during scan', async () => {
    const markets = [makeMarket()];
    const yesBook = makeBook({ tokenId: 'yes-1', bestAsk: 0.45, bestAskSizeUsd: 100 });
    const noBook = makeBook({ tokenId: 'no-1', bestAsk: 0.45, bestAskSizeUsd: 100 });

    const marketScanner = { fetchMarkets: jest.fn().mockResolvedValue(markets) };
    const orderbookClient = {
      fetchBook: jest.fn()
        .mockResolvedValueOnce(yesBook)
        .mockResolvedValueOnce(noBook),
    };
    const logger = { write: jest.fn() };
    const result = await runPairCostScanCycle(marketScanner, orderbookClient, logger, DEFAULT_CONFIG);

    expect(result).toHaveLength(1);
    expect(result[0].conditionId).toBe('cid-1');
    expect(logger.write).toHaveBeenCalledTimes(1);
    expect(logger.write).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'pair_opportunity',
      conditionId: 'cid-1',
    }));
  });

  it('logs no_opportunities when nothing found', async () => {
    const markets = [makeMarket()];
    const yesBook = makeBook({ tokenId: 'yes-1', bestAsk: 0.55, bestAskSizeUsd: 100 });
    const noBook = makeBook({ tokenId: 'no-1', bestAsk: 0.55, bestAskSizeUsd: 100 });

    const marketScanner = { fetchMarkets: jest.fn().mockResolvedValue(markets) };
    const orderbookClient = {
      fetchBook: jest.fn()
        .mockResolvedValueOnce(yesBook)
        .mockResolvedValueOnce(noBook),
    };
    const logger = { write: jest.fn() };
    const result = await runPairCostScanCycle(marketScanner, orderbookClient, logger, DEFAULT_CONFIG);

    expect(result).toHaveLength(0);
    expect(logger.write).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'no_opportunities',
    }));
  });

  it('logs cycle_error when market fetch fails', async () => {
    const marketScanner = { fetchMarkets: jest.fn().mockRejectedValue(new Error('network')) };
    const orderbookClient = { fetchBook: jest.fn() };
    const logger = { write: jest.fn() };

    const result = await runPairCostScanCycle(marketScanner, orderbookClient, logger, DEFAULT_CONFIG);
    expect(result).toEqual([]);
    expect(logger.write).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'cycle_error',
      error: 'network',
    }));
  });
});
