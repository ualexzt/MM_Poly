export function isBookStale(lastUpdateMs: number, maxAgeMs: number): boolean {
  return Date.now() - lastUpdateMs > maxAgeMs;
}
