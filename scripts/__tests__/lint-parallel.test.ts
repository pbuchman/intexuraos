import { describe, expect, it } from 'vitest';
import { parseLintArgs } from '../lint-parallel.mjs'; // @allow-missing-js -- .mjs import

describe('lint-parallel argument parsing', () => {
  it('keeps recognized control flags out of target paths', () => {
    expect(parseLintArgs(['--', '--sequential', '--shard=2/3', 'apps/web/src/App.tsx'])).toEqual({
      sequentialMode: true,
      shard: { index: 2, count: 3 },
      targetPaths: ['apps/web/src/App.tsx'],
    });
  });

  it('rejects unknown flags before they can be treated as paths', () => {
    expect(() => parseLintArgs(['--cache', 'apps/web/src/App.tsx'])).toThrow(
      /Unknown lint flag "--cache"/
    );
  });

  it('allows dash-prefixed paths only after the explicit separator', () => {
    expect(parseLintArgs(['--', '--', '--generated/file.ts'])).toEqual({
      sequentialMode: false,
      shard: null,
      targetPaths: ['--generated/file.ts'],
    });
  });
});
