import { isBookStale } from '../../src/risk/stale-book-guard';

describe('stale-book-guard', () => {
  test('fresh book is not stale', () => {
    expect(isBookStale(Date.now(), 2000)).toBe(false);
  });

  test('old book is stale', () => {
    expect(isBookStale(Date.now() - 3000, 2000)).toBe(true);
  });
});
