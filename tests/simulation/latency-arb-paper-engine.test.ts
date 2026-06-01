import { LatencyArbPaperEngine, PaperTradeResult } from '../../src/simulation/latency-arb-paper-engine';

describe('LatencyArbPaperEngine', () => {
  it('should simulate BUY YES trade correctly', () => {
    const engine = new LatencyArbPaperEngine({ initialBalance: 1000 });
    
    const result = engine.executeTrade({
      action: 'BUY_YES',
      entryPrice: 0.45,
      sizeUsd: 50,
      timestamp: Date.now()
    });
    
    expect(result.action).toBe('BUY_YES');
    expect(result.entryPrice).toBe(0.45);
    expect(result.shares).toBeCloseTo(50 / 0.45, 2);
    expect(result.costUsd).toBe(50);
  });

  it('should resolve trade correctly when YES wins', () => {
    const engine = new LatencyArbPaperEngine({ initialBalance: 1000 });
    
    engine.executeTrade({
      action: 'BUY_YES',
      entryPrice: 0.45,
      sizeUsd: 50,
      timestamp: Date.now() - 60000
    });
    
    const trades = engine.getOpenTrades();
    expect(trades.length).toBe(1);
    
    // Resolve YES wins
    engine.resolveTrade(trades[0].id, 'YES');
    
    const closedTrades = engine.getClosedTrades();
    expect(closedTrades.length).toBe(1);
    expect(closedTrades[0].profitUsd).toBeGreaterThan(0);
  });

  it('should resolve trade correctly when NO wins', () => {
    const engine = new LatencyArbPaperEngine({ initialBalance: 1000 });
    
    engine.executeTrade({
      action: 'BUY_YES',
      entryPrice: 0.45,
      sizeUsd: 50,
      timestamp: Date.now() - 60000
    });
    
    const trades = engine.getOpenTrades();
    engine.resolveTrade(trades[0].id, 'NO');
    
    const closedTrades = engine.getClosedTrades();
    expect(closedTrades[0].profitUsd).toBeLessThan(0);
  });

  it('should track PnL correctly', () => {
    const engine = new LatencyArbPaperEngine({ initialBalance: 1000 });
    
    // Winning trade
    engine.executeTrade({
      action: 'BUY_YES',
      entryPrice: 0.45,
      sizeUsd: 50,
      timestamp: Date.now() - 120000
    });
    
    let trades = engine.getOpenTrades();
    engine.resolveTrade(trades[0].id, 'YES');
    
    // Losing trade
    engine.executeTrade({
      action: 'BUY_NO',
      entryPrice: 0.55,
      sizeUsd: 50,
      timestamp: Date.now() - 60000
    });
    
    trades = engine.getOpenTrades();
    engine.resolveTrade(trades[0].id, 'YES');
    
    const stats = engine.getStats();
    expect(stats.totalTrades).toBe(2);
    expect(stats.winRate).toBe(0.5);
    expect(stats.totalPnlUsd).toBeDefined();
  });

  it('should enforce position limits', () => {
    const engine = new LatencyArbPaperEngine({ 
      initialBalance: 1000,
      maxPositionUsd: 100
    });
    
    // First trade OK
    engine.executeTrade({
      action: 'BUY_YES',
      entryPrice: 0.45,
      sizeUsd: 80,
      timestamp: Date.now()
    });
    
    // Second trade should fail (exceeds limit)
    expect(() => {
      engine.executeTrade({
        action: 'BUY_YES',
        entryPrice: 0.45,
        sizeUsd: 50,
        timestamp: Date.now()
      });
    }).toThrow('Position limit exceeded');
  });
});
