import { DataApiClient, PolymarketPosition } from '../../src/data/data-api-client';

describe('DataApiClient', () => {
  describe('mapRawPositions', () => {
    it('maps raw API response to PolymarketPosition array', () => {
      const raw = [
        {
          asset: 'token-yes-1',
          conditionId: 'cond-1',
          size: '50',
          avgPrice: '0.45',
          curPrice: '0.52',
          initialValue: '22.5',
          currentValue: '26',
          cashPnl: '3.5',
          percentPnl: '15.56',
          realizedPnl: '0',
          outcome: 'Yes',
          outcomeIndex: 0,
          title: 'Will X happen?',
          slug: 'will-x-happen',
          proxyWallet: '0xabc',
          endDate: '2026-12-31',
          redeemable: false,
          negativeRisk: false,
        },
      ];

      const client = new DataApiClient('https://data-api.polymarket.com', '0xabc');
      const positions = client.mapRawPositions(raw);

      expect(positions).toHaveLength(1);
      expect(positions[0].tokenId).toBe('token-yes-1');
      expect(positions[0].conditionId).toBe('cond-1');
      expect(positions[0].size).toBe(50);
      expect(positions[0].avgPrice).toBe(0.45);
      expect(positions[0].curPrice).toBe(0.52);
      expect(positions[0].cashPnl).toBe(3.5);
      expect(positions[0].realizedPnl).toBe(0);
      expect(positions[0].outcome).toBe('Yes');
      expect(positions[0].title).toBe('Will X happen?');
    });

    it('filters out zero-size positions', () => {
      const raw = [
        { asset: 't1', conditionId: 'c1', size: '0', avgPrice: '0', curPrice: '0', initialValue: '0', currentValue: '0', cashPnl: '0', percentPnl: '0', realizedPnl: '0', outcome: 'Yes', outcomeIndex: 0, title: '', slug: '', proxyWallet: '0x', endDate: '', redeemable: false, negativeRisk: false },
        { asset: 't2', conditionId: 'c2', size: '10', avgPrice: '0.5', curPrice: '0.6', initialValue: '5', currentValue: '6', cashPnl: '1', percentPnl: '20', realizedPnl: '0', outcome: 'No', outcomeIndex: 1, title: '', slug: '', proxyWallet: '0x', endDate: '', redeemable: false, negativeRisk: false },
      ];

      const client = new DataApiClient('https://data-api.polymarket.com', '0xabc');
      const positions = client.mapRawPositions(raw);

      expect(positions).toHaveLength(1);
      expect(positions[0].tokenId).toBe('t2');
    });

    it('handles empty array', () => {
      const client = new DataApiClient('https://data-api.polymarket.com', '0xabc');
      expect(client.mapRawPositions([])).toEqual([]);
    });

    it('handles non-array input gracefully', () => {
      const client = new DataApiClient('https://data-api.polymarket.com', '0xabc');
      expect(client.mapRawPositions(null as any)).toEqual([]);
      expect(client.mapRawPositions(undefined as any)).toEqual([]);
    });
  });
});
