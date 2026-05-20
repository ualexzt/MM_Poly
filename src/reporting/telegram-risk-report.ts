import { TradingActivitySnapshot } from '../accounting/trading-activity-tracker';
import { MarketRiskDecision, RiskStatus, StrategyMode } from '../risk/strategy-risk-manager';

export interface TelegramRiskReportInput {
  mode: StrategyMode;
  startedAt: Date;
  reportAt: Date;
  warningsCount: number;
  errorsCount: number;
  pnl: {
    realizedPeriod: number;
    realizedCumulative: number;
    unrealizedFairBased: number;
    estimatedMakerRebate: number;
    estimatedTotalPnl: number;
    valuationMode: 'fair' | 'bid_ask' | 'orderbook_depth';
  };
  activity: TradingActivitySnapshot;
  risk: {
    status: RiskStatus;
    reasons: string[];
    reduceOnlyActive: boolean;
    killSwitchActive: boolean;
    openPositions: number;
    topMarketDecision: MarketRiskDecision | null;
    topInventoryDecisions?: MarketRiskDecision[];
    singleMarketConcentrationPct: number | null;
    unrealizedToRealizedRatio: number | null;
  };
  marketTitleByConditionId: Map<string, string>;
}

export function formatTelegramRiskReport(input: TelegramRiskReportInput): string {
  const top = input.risk.topMarketDecision;
  const marketTitle = getMarketTitle(input, top);
  const position = formatPosition(top);
  const openPositions = input.risk.openPositions;
  const bidAsk = formatBidAsk(top);
  const quoteShare = formatQuoteShare(input.activity.primaryMarketQuoteTraces, input.activity.quoteTraces);
  const worstCase = formatWorstCase(top);

  return `
📊 <b>Oraculus ${formatModeTitle(input.mode)} Report — ${formatUtcDate(input.reportAt)}</b>

${statusEmoji(input.risk.status)} <b>Status: ${input.risk.status}</b>
Reason: ${input.risk.reasons.length > 0 ? escapeHtml(input.risk.reasons.join(', ')) : 'none'}

🟢 <b>Health</b>
Mode: ${input.mode.toUpperCase()}
App Uptime: ${formatDuration(input.reportAt.getTime() - input.startedAt.getTime())}
Errors/Warnings: ${input.errorsCount}/${input.warningsCount}

💰 <b>PnL</b>
Realized Period: ${formatSignedUsd(input.pnl.realizedPeriod)}
Realized Total: ${formatSignedUsd(input.pnl.realizedCumulative)}
Unrealized: ${formatSignedUsd(input.pnl.unrealizedFairBased)}
Est. Rebates: ${formatSignedUsd(input.pnl.estimatedMakerRebate)}
Estimated Total: ${formatSignedUsd(input.pnl.estimatedTotalPnl)}
Estimated Total ex Rebates: ${formatSignedUsd(input.pnl.realizedCumulative + input.pnl.unrealizedFairBased)}
Valuation: ${formatValuationMode(input.pnl.valuationMode)}

📈 <b>Activity</b>
Fills: ${input.activity.fillsTotal}
BUY: ${input.activity.buyFills} fills / ${formatContracts(input.activity.buyContracts)} contracts / ${formatUsd(input.activity.buyNotional)}
SELL: ${input.activity.sellFills} fills / ${formatContracts(input.activity.sellContracts)} contracts / ${formatUsd(input.activity.sellNotional)}
Volume: ${formatContracts(input.activity.totalContracts)} contracts / ${formatUsd(input.activity.notionalVolume)}
Active Markets: ${input.activity.activeMarkets}
Open Positions: ${openPositions}
Quotes: ${formatInteger(input.activity.quoteTraces)} generated: ${formatInteger(input.activity.quoteGeneratedCount)} rejected: ${formatInteger(input.activity.quoteRejectedCount)}

📦 <b>Inventory</b>
Position: ${position}
Avg Entry: ${formatNullablePrice(top?.avgEntryPrice ?? null)}
Fair: ${formatNullablePrice(top?.currentFair ?? null)}
Bid/Ask: ${bidAsk}
Inventory Usage: ${formatNullablePct(top?.inventoryUsagePct ?? null)}
Reduce-only: ${input.risk.reduceOnlyActive ? 'ON' : 'OFF'}

⚠️ <b>Risk</b>
Market Concentration: ${formatNullablePct(input.risk.singleMarketConcentrationPct)}
Unrealized/Realized: ${input.risk.unrealizedToRealizedRatio !== null ? `${input.risk.unrealizedToRealizedRatio.toFixed(2)}x` : 'n/a'}
${worstCase}
Kill Switch: ${input.risk.killSwitchActive ? 'ON' : 'OFF'}
Exit at Bid/Ask: ${top?.exitPnlAtBestBidAsk !== null && top?.exitPnlAtBestBidAsk !== undefined ? formatSignedUsd(top.exitPnlAtBestBidAsk) : 'not available'}

📊 <b>Top Inventory Markets</b>
${formatTopInventoryMarkets(input.risk.topInventoryDecisions ?? null, input.marketTitleByConditionId)}

🎯 <b>Main Market</b>
${escapeHtml(marketTitle)}
Quote Share: ${quoteShare}

🧭 <b>Action</b>
${formatAction(input.mode, input.risk.status, input.risk.reasons)}
  `.trim();
}

function getMarketTitle(input: TelegramRiskReportInput, top: MarketRiskDecision | null): string {
  if (top) return input.marketTitleByConditionId.get(top.conditionId) ?? top.conditionId;
  if (input.activity.primaryMarketConditionId) {
    return input.marketTitleByConditionId.get(input.activity.primaryMarketConditionId) ?? input.activity.primaryMarketConditionId;
  }
  return 'n/a';
}

function formatModeTitle(mode: StrategyMode): string {
  if (mode === 'small_live') return 'Small Live';
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

function formatUtcDate(date: Date): string {
  return `${date.toISOString().replace('T', ' ').slice(0, 16)} UTC`;
}

function statusEmoji(status: RiskStatus): string {
  if (status === 'OK') return '🟢';
  if (status === 'WATCH') return '🟡';
  if (status === 'WARNING') return '⚠️';
  return '🚨';
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatSignedUsd(value: number): string {
  const sign = value >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatValuationMode(mode: TelegramRiskReportInput['pnl']['valuationMode']): string {
  if (mode === 'fair') return 'fair-based';
  if (mode === 'bid_ask') return 'bid/ask-based';
  return 'orderbook-depth-based';
}

function formatContracts(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(2);
}

function formatInteger(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

function formatPosition(top: MarketRiskDecision | null): string {
  if (!top || top.positionSide === 'FLAT') return 'FLAT';
  return `${top.positionSide} ${formatContracts(Math.abs(top.netPosition))}`;
}

function formatNullablePrice(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(4);
}

function formatBidAsk(top: MarketRiskDecision | null): string {
  const bid = formatNullablePrice(top?.currentBid ?? null);
  const ask = formatNullablePrice(top?.currentAsk ?? null);
  return `${bid} / ${ask}`;
}

function formatNullablePct(value: number | null): string {
  return value === null ? 'n/a' : `${value.toFixed(2)}%`;
}

function formatQuoteShare(primaryMarketQuoteTraces: number, quoteTraces: number): string {
  if (quoteTraces <= 0) return 'n/a';
  return `${formatInteger(primaryMarketQuoteTraces)} / ${formatInteger(quoteTraces)}`;
}

function formatTopInventoryMarkets(decisions: MarketRiskDecision[] | null, titleMap: Map<string, string>): string {
  if (!decisions || decisions.length === 0) return 'n/a';

  return decisions
    .map((decision, index) => {
      const title = titleMap.get(decision.conditionId) ?? decision.conditionId;
      const position = formatPosition(decision);
      const usage = formatNullablePct(decision.inventoryUsagePct);
      const exitPnl = decision.exitPnlAtBestBidAsk !== null ? formatSignedUsd(decision.exitPnlAtBestBidAsk) : 'n/a';
      return `${index + 1}. ${escapeHtml(title)} — ${position} — Inventory Usage: ${usage} — Exit at Bid/Ask: ${exitPnl}`;
    })
    .join('\n');
}

function formatWorstCase(top: MarketRiskDecision | null): string {
  if (!top || top.positionSide === 'FLAT') return 'Worst Case: n/a';

  if (top.positionSide === 'SHORT') {
    return `Worst Case to YES=1.00: ${top.worstCaseLossToOne !== null ? `-${formatUsd(Math.abs(top.worstCaseLossToOne))}` : 'n/a'}`;
  }

  return `Worst Case to YES=0.00: ${top.worstCaseLossToZero !== null ? `-${formatUsd(Math.abs(top.worstCaseLossToZero))}` : 'n/a'}`;
}

function formatAction(mode: StrategyMode, status: RiskStatus, reasons: string[]): string {
  if (mode === 'disabled') return 'Bot disabled. Review configuration before enabling trading.';

  if (status === 'OK') {
    return 'Continue PAPER soak and monitor normal risk metrics.';
  }

  if (status === 'WATCH' && reasons.includes('inventory_soft_limit_exceeded')) {
    return 'Stay PAPER and monitor whether inventory decays back below soft limit.';
  }

  if (status === 'WATCH') {
    return 'Stay PAPER and inspect listed reasons before considering LIVE.';
  }

  if (status === 'WARNING') {
    return 'Inspect top inventory markets and reduce exposure before considering LIVE.';
  }

  return 'Review cancel and kill-switch path before continuing.';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
