import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const SCRIPT = 'scripts/verify-v8-ignore.mjs';

describe('verify-v8-ignore coverage data mode', () => {
  it('can skip coverage-data cross-checks for pre-test static validation', () => {
    const result = spawnSync('node', [SCRIPT, '--skip-coverage-data'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Coverage data checks skipped');
  });
});
