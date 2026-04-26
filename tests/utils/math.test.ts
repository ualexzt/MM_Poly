import { roundDownToTick, roundUpToTick, computeMidpoint, microprice } from '../../src/utils/math';

describe('math utils', () => {
  test('roundDownToTick rounds down to nearest tick', () => {
    expect(roundDownToTick(0.53, 0.01)).toBe(0.53);
    expect(roundDownToTick(0.531, 0.01)).toBe(0.53);
    expect(roundDownToTick(0.539, 0.01)).toBe(0.53);
  });

  test('roundUpToTick rounds up to nearest tick', () => {
    expect(roundUpToTick(0.53, 0.01)).toBe(0.53);
    expect(roundUpToTick(0.531, 0.01)).toBe(0.54);
    expect(roundUpToTick(0.001, 0.01)).toBe(0.01);
  });

  test('computeMidpoint returns average of bid and ask', () => {
    expect(computeMidpoint(0.45, 0.55)).toBe(0.50);
    expect(computeMidpoint(0.50, 0.52)).toBe(0.51);
  });

  test('microprice computes size-weighted midpoint', () => {
    expect(microprice(0.45, 0.55, 100, 100)).toBe(0.50);
    expect(microprice(0.45, 0.55, 100, 900)).toBe(0.46);
  });
});
