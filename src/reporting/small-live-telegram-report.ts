export interface SmallLiveTelegramReportInput {
  mode: string;
  reportAt: Date;
  balanceUsd: number;
  openOrdersCount: number;
  openOrdersNotionalUsd: number;
  positionsCount: number;
  positionsValueUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  fillsCount: number;
  rejectsCount: number;
  activeMarkets: number;
  riskState: 'OK' | 'WARN' | 'STOP';
}

export interface SmallLiveAlertInput {
  severity: 'INFO' | 'WARN' | 'CRITICAL';
  title: string;
  detail: string;
}

export function formatSmallLiveTelegramReport(input: SmallLiveTelegramReportInput): string {
  return [
    `📊 <b>Small Live Report</b> — ${formatUtcDate(input.reportAt)}`,
    `Mode: ${escapeHtml(input.mode)}`,
    `Balance: ${formatUsd(input.balanceUsd)}`,
    `Open orders: ${input.openOrdersCount} / ${formatUsd(input.openOrdersNotionalUsd)}`,
    `Positions: ${input.positionsCount} / ${formatUsd(input.positionsValueUsd)}`,
    `PnL: realized ${formatSignedUsd(input.realizedPnlUsd)} / unrealized ${formatSignedUsd(input.unrealizedPnlUsd)}`,
    `Fills 3h: ${input.fillsCount}`,
    `Rejects 3h: ${input.rejectsCount}`,
    `Active markets: ${input.activeMarkets}`,
    `Risk state: ${input.riskState}`,
  ].join('\n');
}

export function formatSmallLiveAlert(input: SmallLiveAlertInput): string {
  return [
    `🚨 <b>${input.severity}</b> — ${escapeHtml(input.title)}`,
    escapeHtml(input.detail),
  ].join('\n');
}

function formatUtcDate(date: Date): string {
  return `${date.toISOString().replace('T', ' ').slice(0, 16)} UTC`;
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatSignedUsd(value: number): string {
  return value < 0 ? `-${formatUsd(Math.abs(value))}` : formatUsd(value);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
