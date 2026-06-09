import { describe, expect, it } from 'vitest';
import { parseShardArg, selectShardItems } from '../lib/sharding.mjs'; // @allow-missing-js -- .mjs import

describe('CI sharding helpers', () => {
  it('parses shard arguments in index/count format', () => {
    expect(parseShardArg('2/5')).toEqual({ index: 2, count: 5 });
  });

  it('rejects invalid shard arguments', () => {
    expect(() => parseShardArg('0/3')).toThrow(/Shard index must be between 1 and 3/);
    expect(() => parseShardArg('4/3')).toThrow(/Shard index must be between 1 and 3/);
    expect(() => parseShardArg('two/3')).toThrow(/Invalid shard/);
  });

  it('selects deterministic non-overlapping shard subsets', () => {
    const workspaces = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

    expect(selectShardItems(workspaces, { index: 1, count: 3 })).toEqual(['a', 'd', 'g']);
    expect(selectShardItems(workspaces, { index: 2, count: 3 })).toEqual(['b', 'e']);
    expect(selectShardItems(workspaces, { index: 3, count: 3 })).toEqual(['c', 'f']);
  });
});
