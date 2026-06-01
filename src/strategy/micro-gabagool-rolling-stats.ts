export interface WmpInput {
  bestBid: number;
  bestAsk: number;
  bestBidSizeUsd: number;
  bestAskSizeUsd: number;
}

export interface MarketStatsSample extends WmpInput {
  timestampMs: number;
}

export interface RollingMarketStatsResult {
  wmp: number;
  wmpDelta3Min: number;
  spreadChangesLast60Sec: number;
}

interface StoredSample {
  timestampMs: number;
  wmp: number;
  spread: number;
}

const THREE_MINUTES_MS = 180_000;
const ONE_MINUTE_MS = 60_000;
const RETENTION_MS = 300_000;
const SPREAD_EPSILON = 1e-9;

export function computeWeightedMidPrice(input: WmpInput): number {
  const totalSizeUsd = input.bestBidSizeUsd + input.bestAskSizeUsd;

  if (totalSizeUsd <= 0) {
    return (input.bestBid + input.bestAsk) / 2;
  }

  return ((input.bestBid * input.bestAskSizeUsd) + (input.bestAsk * input.bestBidSizeUsd)) / totalSizeUsd;
}

export class RollingMarketStats {
  private readonly history = new Map<string, StoredSample[]>();

  update(marketId: string, sample: MarketStatsSample): RollingMarketStatsResult {
    const wmp = computeWeightedMidPrice(sample);
    const spread = sample.bestAsk - sample.bestBid;
    const samples = this.history.get(marketId) ?? [];

    samples.push({ timestampMs: sample.timestampMs, wmp, spread });

    const retentionCutoffMs = sample.timestampMs - RETENTION_MS;
    const prunedSamples = samples.filter((storedSample) => storedSample.timestampMs >= retentionCutoffMs);
    this.history.set(marketId, prunedSamples);

    const threeMinuteCutoffMs = sample.timestampMs - THREE_MINUTES_MS;
    const referenceSample = [...prunedSamples].reverse().find((storedSample) => storedSample.timestampMs <= threeMinuteCutoffMs);
    const wmpDelta3Min = referenceSample ? Math.abs(wmp - referenceSample.wmp) : 0;

    const spreadWindowStartMs = sample.timestampMs - ONE_MINUTE_MS;
    const spreadWindow = prunedSamples.filter((storedSample) => storedSample.timestampMs >= spreadWindowStartMs);
    let spreadChangesLast60Sec = 0;

    for (let index = 1; index < spreadWindow.length; index += 1) {
      if (Math.abs(spreadWindow[index].spread - spreadWindow[index - 1].spread) > SPREAD_EPSILON) {
        spreadChangesLast60Sec += 1;
      }
    }

    return { wmp, wmpDelta3Min, spreadChangesLast60Sec };
  }
}
