import { describe, expect, it, vi } from 'vitest';

import { metadata, up } from '../078_fix-execution-memory-vector-index-format.mjs'; // @allow-missing-js -- .mjs import

describe('078-fix-execution-memory-vector-index-format migration', () => {
  it('exports the expected metadata', () => {
    expect(metadata).toMatchObject({
      id: '078',
      name: 'fix-execution-memory-vector-index-format',
      createdAt: '2026-04-04',
    });
  });

  it('redeploys indexes in up()', async () => {
    const deployIndexes = vi.fn().mockResolvedValue(undefined);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await up({ deployIndexes });

    expect(deployIndexes).toHaveBeenCalledTimes(1);

    consoleSpy.mockRestore();
  });
});
