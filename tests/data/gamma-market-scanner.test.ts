import { GammaApiScanner } from '../../src/data/gamma-market-scanner';

describe('GammaApiScanner', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('fetches a broad market page for live filtering', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    });
    global.fetch = fetchMock as any;

    const scanner = new GammaApiScanner('https://gamma.example');
    await scanner.fetchMarkets();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://gamma.example/markets?active=true&closed=false&limit=500',
      expect.anything()
    );
  });
});
