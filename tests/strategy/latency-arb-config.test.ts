import { defaultLatencyArbConfig } from '../../src/strategy/latency-arb-config';

describe('defaultLatencyArbConfig live-like shadow fields', () => {
  it('should default to BTC 15m shadow soak settings', () => {
    expect(defaultLatencyArbConfig.marketAsset).toBe('BTC');
    expect(defaultLatencyArbConfig.marketDurationMinutes).toBe(15);
    expect(defaultLatencyArbConfig.startingBalanceUsd).toBe(15.48);
    expect(defaultLatencyArbConfig.orderBalanceFraction).toBe(0.1);
    expect(defaultLatencyArbConfig.maxOrderSizeUsd).toBe(1.55);
    expect(defaultLatencyArbConfig.maxSpreadCents).toBe(8);
    expect(defaultLatencyArbConfig.maxMarketAgeMs).toBe(2000);
    expect(defaultLatencyArbConfig.simulatedLatencyMs).toBe(750);
    expect(defaultLatencyArbConfig.logDir).toBe('logs');
  });
});
