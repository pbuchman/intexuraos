import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildCoverageShardCommand, mergeShardOutputs } from '../lib/coverage-sharding.mjs'; // @allow-missing-js -- .mjs import

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

  it('excludes local hook test copies from root coverage discovery', () => {
    const rootVitestConfig = readFileSync('vitest.config.ts', 'utf-8');

    expect(rootVitestConfig).toContain("'.claude/hooks/__tests__/**'");
    expect(rootVitestConfig).toContain("'.codex/hooks/__tests__/**'");
  });
});
