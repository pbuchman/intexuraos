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
        '   Per blob  155.57s 130.89s 159.80s',
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

  it('allows Vitest blob merge timing summary lines', () => {
    mkdirSync('scripts/test-results', { recursive: true });
    writeFileSync(
      OUTPUT_FILE,
      [
        ' RUN  v4.0.17 /repo',
        ' Test Files  965 passed (965)',
        '      Tests  17314 passed (17314)',
        '   Duration  446.26s (transform 0ms, setup 31.74s, import 169.87s, tests 522.05s, environment 9.03s)',
        '   Per blob  155.57s 130.89s 159.80s',
      ].join('\n')
    );

    const result = spawnSync('node', [SCRIPT], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('No unexpected test stdout output detected');
  });

  it('allows known vitest 4.0.17 coverage tmp dir ENOENT unhandled rejection', () => {
    mkdirSync('scripts/test-results', { recursive: true });
    writeFileSync(
      OUTPUT_FILE,
      [
        ' RUN  v4.0.17 /repo',
        ' ✓ apps/code-agent/src/__tests__/routes/code/feedback-routes.test.ts (2 tests) 70ms',
        '⎯⎯⎯⎯ Unhandled Rejection ⎯⎯⎯⎯⎯',
        "Error: ENOENT: no such file or directory, open '/repo/coverage/shard-1/.tmp-1-3/coverage-120.json'",
        '  ❯ open node:internal/fs/promises:639:25',
        '  ❯ Object.writeFile node:internal/fs/promises:1222:14',
        '⎯⎯⎯⎯⎯⎯⎯⎯⎯',
        "Serialized Error: { errno: -2, code: 'ENOENT', syscall: 'open', path: '/repo/coverage/shard-2/.tmp-2-3/coverage-171.json' }",
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

  it('allows known vitest 4.0.17 coverage tmp dir ENOENT unhandled error during merge', () => {
    mkdirSync('scripts/test-results', { recursive: true });
    writeFileSync(
      OUTPUT_FILE,
      [
        ' RUN  v4.0.17 /repo',
        ' ✓ apps/code-agent/src/__tests__/routes/code/feedback-routes.test.ts (2 tests) 70ms',
        '⎯⎯⎯⎯ Unhandled Error ⎯⎯⎯⎯⎯',
        "Error: ENOENT: no such file or directory, read '/repo/coverage/shard-2/.tmp-2-3/coverage-11.json'",
        '  ❯ open node:internal/fs/promises:639:25',
        '  ❯ Object.readFile node:internal/fs/promises:1252:14',
        '  ❯ node_modules/.pnpm/vitest@4.0.17/node_modules/vitest/dist/chunks/coverage.js:2999:23',
        '  ❯ node_modules/.pnpm/@vitest+coverage-v8@4.0.17/node_modules/@vitest/coverage-v8/dist/provider.js:33:3',
        '⎯⎯⎯⎯⎯⎯⎯⎯⎯',
        "Serialized Error: { errno: -2, code: 'ENOENT', syscall: 'read', path: '/repo/coverage/shard-2/.tmp-2-3/coverage-11.json' }",
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

  it('allows known vitest 4.0.17 coverage tmp dir ENOENT lstat unhandled error during cleanup', () => {
    mkdirSync('scripts/test-results', { recursive: true });
    writeFileSync(
      OUTPUT_FILE,
      [
        ' RUN  v4.0.17 /repo',
        ' ✓ apps/web/src/__tests__/bundle-budget.test.ts (1 test) 2ms',
        '⎯⎯⎯⎯ Unhandled Error ⎯⎯⎯⎯⎯',
        "Error: ENOENT: no such file or directory, lstat '/repo/coverage/shard-1/.tmp-1-3'",
        '⎯⎯⎯⎯⎯⎯⎯⎯⎯',
        "Serialized Error: { errno: -2, code: 'ENOENT', syscall: 'lstat', path: '/repo/coverage/shard-1/.tmp-1-3' }",
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

  it('allows coverage tmp race separators after long Vitest stack traces', () => {
    mkdirSync('scripts/test-results', { recursive: true });
    writeFileSync(
      OUTPUT_FILE,
      [
        ' RUN  v4.0.17 /repo',
        ' ✓ apps/web/src/pages/__tests__/HomePage.size.test.ts (1 test) 3ms',
        '⎯⎯⎯⎯ Unhandled Error ⎯⎯⎯⎯⎯',
        "Error: ENOENT: no such file or directory, open '/repo/coverage/shard-1/.tmp-1-3/coverage-194.json'",
        '  ❯ open node:internal/fs/promises:639:25',
        '  ❯ Object.readFile node:internal/fs/promises:1252:14',
        '  ❯ node_modules/.pnpm/vitest@4.0.17/node_modules/vitest/dist/chunks/coverage.js:2999:23',
        '  ❯ V8CoverageProvider.readCoverageFiles node_modules/.pnpm/vitest@4.0.17/node_modules/vitest/dist/chunks/coverage.js:2998:5',
        '  ❯ V8CoverageProvider.generateCoverage node_modules/.pnpm/@vitest+coverage-v8@4.0.17/node_modules/@vitest/coverage-v8/dist/provider.js:33:3',
        '  ❯ node_modules/.pnpm/vitest@4.0.17/node_modules/vitest/dist/chunks/cli-api.js:12609:23',
        '  ❯ node_modules/.pnpm/vitest@4.0.17/node_modules/vitest/dist/chunks/cli-api.js:12622:11',
        '  ❯ node_modules/.pnpm/vitest@4.0.17/node_modules/vitest/dist/chunks/cli-api.js:12506:19',
        '  ❯ startVitest node_modules/.pnpm/vitest@4.0.17/node_modules/vitest/dist/chunks/cli-api.js:13516:8',
        '⎯⎯⎯⎯⎯⎯⎯⎯⎯',
        "Serialized Error: { errno: -2, code: 'ENOENT', syscall: 'open', path: '/repo/coverage/shard-1/.tmp-1-3/coverage-194.json' }",
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

  it('rejects standalone separator-only stdout pollution', () => {
    mkdirSync('scripts/test-results', { recursive: true });
    writeFileSync(
      OUTPUT_FILE,
      [
        ' RUN  v4.0.17 /repo',
        ' ✓ apps/code-agent/src/__tests__/routes/code/feedback-routes.test.ts (2 tests) 70ms',
        '⎯⎯⎯⎯⎯⎯⎯⎯',
        ' Tests  1 passed',
      ].join('\n')
    );

    const result = spawnSync('node', [SCRIPT], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Found 1 unexpected stdout line');
  });
});
