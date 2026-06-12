import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const OUTPUT_FILE = 'scripts/test-results/test-output.txt';
const SCRIPT = 'scripts/verify-test-stdout.mjs';

describe('verify-test-stdout', () => {
  let originalOutput: string | null;

  beforeEach(() => {
    originalOutput = existsSync(OUTPUT_FILE) ? readFileSync(OUTPUT_FILE, 'utf-8') : null;
  });

  afterEach(() => {
    if (originalOutput === null) {
      rmSync(OUTPUT_FILE, { force: true });
    } else {
      writeFileSync(OUTPUT_FILE, originalOutput);
    }
  });

  it('allows Vitest blob reporter artifact lines', () => {
    mkdirSync('scripts/test-results', { recursive: true });
    writeFileSync(
      OUTPUT_FILE,
      [
        ' RUN  v4.0.17 /repo',
        ' ✓ apps/web/src/pages/__tests__/LinearIssuesPage.size.test.ts (1 test) 1ms',
        'blob report written to /repo/.vitest-reports/blob-1-3.json',
        ' Tests  1 passed',
      ].join('\n')
    );

    const result = spawnSync('node', [SCRIPT], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('No unexpected test stdout output detected');
  });
});
