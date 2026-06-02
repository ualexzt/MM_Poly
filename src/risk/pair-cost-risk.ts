export interface RiskConfig {
  maxExposureUsd: number;
  maxExposurePerMarketUsd: number;
  maxDrawdownPct: number;
  maxOpenOrders: number;
  startingBalanceUsd: number;
}

export interface RiskCheckInput {
  config: RiskConfig;
  totalExposureUsd: number;
  marketExposureUsd: number;
  openOrderCount: number;
  currentBalanceUsd: number;
}

export interface RiskCheckResult {
  allowed: boolean;
  reason: string;
}

export function checkRisk(input: RiskCheckInput): RiskCheckResult {
  const { config, totalExposureUsd, marketExposureUsd, openOrderCount, currentBalanceUsd } = input;

  if (totalExposureUsd > config.maxExposureUsd) {
    return { allowed: false, reason: `total exposure ${totalExposureUsd.toFixed(2)} > max ${config.maxExposureUsd}` };
  }

  if (marketExposureUsd > config.maxExposurePerMarketUsd) {
    return { allowed: false, reason: `market exposure ${marketExposureUsd.toFixed(2)} > max ${config.maxExposurePerMarketUsd}` };
  }

  if (openOrderCount > config.maxOpenOrders) {
    return { allowed: false, reason: `open orders ${openOrderCount} >= max ${config.maxOpenOrders}` };
  }

  const drawdown = (config.startingBalanceUsd - currentBalanceUsd) / config.startingBalanceUsd;
  if (drawdown > config.maxDrawdownPct) {
    return { allowed: false, reason: `drawdown ${(drawdown * 100).toFixed(1)}% > max ${(config.maxDrawdownPct * 100).toFixed(0)}%` };
  }

  return { allowed: true, reason: 'ok' };
}
