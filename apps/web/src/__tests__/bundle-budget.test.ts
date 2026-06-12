// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

describe('bundle budget', () => {
  it('no single chunk exceeds 1.5 MB uncompressed', () => {
    const distAssets = resolve(__dirname, '../../dist/assets');
    if (!existsSync(distAssets)) {
      // dist not built; test is a no-op in unit-test mode
      return;
    }
    const tooLarge = readdirSync(distAssets)
      .filter((f) => f.endsWith('.js'))
      .filter((f) => statSync(resolve(distAssets, f)).size > 1.5 * 1024 * 1024);
    expect(tooLarge).toEqual([]);
  });
});
