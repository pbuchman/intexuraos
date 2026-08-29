import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildCoverageShardCommand,
  coverageShardTmpDirectory,
  isKnownVitestCoverageTmpRace,
  mergeShardOutputs,
  shouldIgnoreCoverageShardFailure,
  shouldRetryCoverageMerge,
  shouldRetryCoverageShard,
} from '../lib/coverage-sharding.mjs'; // @allow-missing-js -- .mjs import

describe('coverage sharding helpers', () => {
  it('builds a Vitest shard command that writes isolated shard artifacts', () => {
    expect(buildCoverageShardCommand(2, 3)).toEqual([
      'vitest',
      'run',
      '--reporter=default',
      '--reporter=blob',
      '--coverage',
      '--coverage.thresholds.lines=0',
      '--coverage.thresholds.branches=0',
      '--coverage.thresholds.functions=0',
      '--coverage.thresholds.statements=0',
      '--coverage.reportsDirectory=coverage/shard-2',
      '--pool=threads',
      '--shard=2/3',
    ]);
  });

  it('merges shard stdout in shard order for verify-test-stdout', () => {
    const output = mergeShardOutputs([
      { shard: 2, output: 'second\n' },
      { shard: 1, output: 'first\n' },
    ]);

    expect(output).toBe('first\nsecond\n');
  });

  it('matches Vitest coverage v8 shard tmp directory naming', () => {
    expect(coverageShardTmpDirectory(2, 3)).toBe('coverage/shard-2/.tmp-2-3');
  });

  it('excludes local hook test copies from root coverage discovery', () => {
    const rootVitestConfig = readFileSync('vitest.config.ts', 'utf-8');

    expect(rootVitestConfig).toContain("'.claude/hooks/__tests__/**'");
    expect(rootVitestConfig).toContain("'.codex/hooks/__tests__/**'");
  });

  it('keeps aggregate coverage thresholds enabled on merge', () => {
    const runShardedCoverageScript = readFileSync('scripts/run-sharded-coverage.mjs', 'utf-8');
    const mergeStep = runShardedCoverageScript.slice(
      runShardedCoverageScript.indexOf('async function runMerge()'),
      runShardedCoverageScript.indexOf('async function runAllShardsWithKnownRaceRetry')
    );

    expect(mergeStep).toContain("'--merge-reports'");
    expect(mergeStep).not.toContain('--coverage.thresholds.');
  });

  it('keeps transient blob reports out of repository inventory between failed CI runs', () => {
    const gitignore = readFileSync('.gitignore', 'utf-8');

    expect(gitignore.split('\n')).toContain('.vitest-reports/');
  });

  it('recognizes the known Vitest coverage tmp ENOENT race', () => {
    expect(
      isKnownVitestCoverageTmpRace(
        [
          '✓ apps/intex-agent/src/__tests__/domain/capabilities.test.ts (15 tests)',
          '⎯⎯⎯⎯ Unhandled Error ⎯⎯⎯⎯⎯',
          "Error: ENOENT: no such file or directory, open '/repo/coverage/shard-2/.tmp-2-3/coverage-11.json'",
          'Tests  399 passed',
        ].join('\n')
      )
    ).toBe(true);
  });

  it('recognizes the known Vitest coverage tmp directory lstat race', () => {
    expect(
      isKnownVitestCoverageTmpRace(
        [
          '✓ apps/web/src/__tests__/bundle-budget.test.ts (1 test)',
          '⎯⎯⎯⎯ Unhandled Error ⎯⎯⎯⎯⎯',
          "Error: ENOENT: no such file or directory, lstat '/repo/coverage/shard-3/.tmp-3-3'",
          "Serialized Error: { errno: -2, code: 'ENOENT', syscall: 'lstat', path: '/repo/coverage/shard-3/.tmp-3-3' }",
          'Tests  399 passed',
        ].join('\n')
      )
    ).toBe(true);
  });

  it('does not treat real Vitest failures as the coverage tmp race', () => {
    expect(
      isKnownVitestCoverageTmpRace(
        [
          'FAIL apps/intex-agent/src/__tests__/domain/capabilities.test.ts > language selector',
          "Error: ENOENT: no such file or directory, open '/repo/coverage/shard-2/.tmp-2-3/coverage-11.json'",
          'Test Files 1 failed',
        ].join('\n')
      )
    ).toBe(false);
  });

  it('retries only non-zero shards with the known Vitest coverage tmp race', () => {
    const knownRaceOutput = [
      '✓ apps/intex-agent/src/__tests__/domain/capabilities.test.ts (15 tests)',
      '⎯⎯⎯⎯ Unhandled Error ⎯⎯⎯⎯⎯',
      "Error: ENOENT: no such file or directory, open '/repo/coverage/shard-2/.tmp-2-3/coverage-0.json'",
      'Tests  399 passed',
    ].join('\n');

    expect(shouldRetryCoverageShard({ code: 1, output: knownRaceOutput })).toBe(true);
    expect(shouldRetryCoverageShard({ code: 0, output: knownRaceOutput })).toBe(false);
    expect(shouldRetryCoverageShard({ code: 1, output: 'FAIL apps/test.test.ts' })).toBe(false);
  });

  it('ignores only non-zero shards with the known cleanup-only lstat race', () => {
    const cleanupRaceOutput = [
      '✓ apps/web/src/__tests__/bundle-budget.test.ts (1 test)',
      '% Coverage report from v8',
      '-------------------|---------|----------|---------|---------|-------------------',
      '⎯⎯⎯⎯ Unhandled Error ⎯⎯⎯⎯⎯',
      "Error: ENOENT: no such file or directory, lstat '/repo/coverage/shard-3/.tmp-3-3'",
      "Serialized Error: { errno: -2, code: 'ENOENT', syscall: 'lstat', path: '/repo/coverage/shard-3/.tmp-3-3' }",
      'Tests  399 passed',
    ].join('\n');

    expect(shouldIgnoreCoverageShardFailure({ code: 1, output: cleanupRaceOutput })).toBe(true);
    expect(shouldRetryCoverageShard({ code: 1, output: cleanupRaceOutput })).toBe(false);
    expect(shouldIgnoreCoverageShardFailure({ code: 0, output: cleanupRaceOutput })).toBe(false);
    expect(shouldIgnoreCoverageShardFailure({ code: 1, output: 'FAIL apps/test.test.ts' })).toBe(
      false
    );
  });

  it('retries only non-zero merge runs with the known Vitest coverage tmp race', () => {
    const knownRaceOutput = [
      '✓ apps/intex-agent/src/__tests__/domain/capabilities.test.ts (15 tests)',
      '⎯⎯⎯⎯ Unhandled Error ⎯⎯⎯⎯⎯',
      "Error: ENOENT: no such file or directory, read '/repo/coverage/shard-2/.tmp-2-3/coverage-0.json'",
      'Tests  399 passed',
    ].join('\n');

    expect(shouldRetryCoverageMerge({ code: 1, output: knownRaceOutput })).toBe(true);
    expect(shouldRetryCoverageMerge({ code: 0, output: knownRaceOutput })).toBe(false);
    expect(shouldRetryCoverageMerge({ code: 1, output: 'FAIL apps/test.test.ts' })).toBe(false);
  });
});
