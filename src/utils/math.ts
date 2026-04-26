export function roundDownToTick(price: number, tickSize: number): number {
  return Math.floor(price / tickSize) * tickSize;
}

export function roundUpToTick(price: number, tickSize: number): number {
  return Math.ceil(price / tickSize) * tickSize;
}

export function computeMidpoint(bestBid: number, bestAsk: number): number {
  return (bestBid + bestAsk) / 2;
}

export function microprice(bestBid: number, bestAsk: number, bidSize: number, askSize: number): number {
  if (bidSize + askSize === 0) return (bestBid + bestAsk) / 2;
  return (bestAsk * bidSize + bestBid * askSize) / (bidSize + askSize);
}
