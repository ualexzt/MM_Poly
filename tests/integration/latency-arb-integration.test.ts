// tests/integration/latency-arb-integration.test.ts
import { LatencyArbStrategy } from '../../src/strategy/latency-arb-strategy';
import { LatencyArbPaperEngine } from '../../src/simulation/latency-arb-paper-engine';

describe('Latency Arb Integration', () => {
  it('should complete full trade cycle', () => {
    const strategy = new LatencyArbStrategy({
      symbols: ['btcusdt'],
      minConfidence: 0.5,
      maxPositionSizeUsd: 50,
      maxDailyTrades: 10,
      cooldownMs: 0, // No cooldown for test
      mode: 'paper',
    });

    const paperEngine = new LatencyArbPaperEngine({
      initialBalance: 1000,
      maxPositionUsd: 200,
    });

    // Simulate strong bullish momentum
    const now = Date.now();
    for (let i = 0; i < 20; i++) {
      strategy.onPriceUpdate({
        symbol: 'btcusdt',
        price: 50000 + i * 200, // Strong uptrend: 50000 → 53800
        timestamp: now - (20 - i) * 3000,
        volume: 100 + i * 20,
        high: 50000 + i * 200 + 100,
        low: 50000 + i * 200 - 100,
      });
    }

    // Get momentum
    const momentum = strategy.getMomentum('btcusdt');
    expect(momentum).toBeDefined();
    expect(momentum!.direction).toBe('BULLISH');

    // Simulate market data
    const market = {
      yesPrice: 0.45,
      noPrice: 0.55,
      midpoint: 0.45,
      spread: 0.10,
      timestamp: now,
    };

    // Analyze
    const signal = strategy.analyzeMarket('btcusdt', market);
    expect(signal).toBeDefined();
    expect(signal!.action).toBe('BUY_YES');

    // Execute paper trade
    if (signal && signal.action !== 'NO_ACTION' && strategy.canTrade()) {
      const result = paperEngine.executeTrade({
        action: signal.action as 'BUY_YES' | 'BUY_NO',
        entryPrice: signal.entryPrice,
        sizeUsd: 50,
        timestamp: now,
      });

      expect(result.shares).toBeGreaterThan(0);
      expect(paperEngine.getOpenTrades().length).toBe(1);

      // Simulate resolution — BUY_YES resolved as YES → win
      paperEngine.resolveTrade(result.id, 'YES');

      const stats = paperEngine.getStats();
      expect(stats.totalTrades).toBe(1);
      expect(stats.currentBalance).toBeGreaterThan(1000); // Should be profitable
    } else {
      fail('Expected signal to produce a tradeable BUY_YES action');
    }
  });
});
