import { buildSubscribeMessages } from '../../src/data/ws-market-stream';

describe('buildSubscribeMessages', () => {
  test('batches token ids into chunks of 100', () => {
    const tokenIds = Array.from({ length: 220 }, (_, i) => `token-${i}`);
    const messages = buildSubscribeMessages(tokenIds);
    expect(messages).toHaveLength(3);
    expect(JSON.parse(messages[0])).toEqual({
      type: 'market',
      assets_ids: tokenIds.slice(0, 100),
    });
    expect(JSON.parse(messages[1])).toEqual({
      type: 'market',
      assets_ids: tokenIds.slice(100, 200),
    });
    expect(JSON.parse(messages[2])).toEqual({
      type: 'market',
      assets_ids: tokenIds.slice(200, 220),
    });
  });

  test('returns single message for fewer than batch size tokens', () => {
    const tokenIds = ['a', 'b', 'c'];
    const messages = buildSubscribeMessages(tokenIds);
    expect(messages).toHaveLength(1);
    expect(JSON.parse(messages[0])).toEqual({
      type: 'market',
      assets_ids: ['a', 'b', 'c'],
    });
  });

  test('returns empty array for no tokens', () => {
    expect(buildSubscribeMessages([])).toHaveLength(0);
  });
});
