import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT = path.resolve(import.meta.dirname, '..', 'verify-required-endpoints.mjs');

describe('verify-required-endpoints', () => {
  it('accepts dist-only service bundles that expose the required endpoints', () => {
    const result = spawnSync('node', [SCRIPT], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/All \d+ services have required endpoints/);
  });
});
