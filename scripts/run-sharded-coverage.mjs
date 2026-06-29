#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  buildCoverageShardCommand,
  mergeShardOutputs,
  shouldIgnoreCoverageShardFailure,
  shouldRetryCoverageMerge,
  shouldRetryCoverageShard,
} from './lib/coverage-sharding.mjs';

const repoRoot = resolve(import.meta.dirname, '..');
const outputPath = join(repoRoot, 'scripts/test-results/test-output.txt');
const KNOWN_RACE_RETRY_LIMIT = 2;
const CLEANUP_RETRY_OPTIONS = { recursive: true, force: true, maxRetries: 5, retryDelay: 100 };

function parseArgs(argv) {
  const shardsArg = argv.find((arg) => arg.startsWith('--shards='));
  const shards = shardsArg ? Number.parseInt(shardsArg.split('=')[1] ?? '', 10) : 3;

  if (!Number.isInteger(shards) || shards < 1) {
    throw new Error('--shards must be a positive integer');
  }

  return { shards };
}

function runShard(shard, shardCount) {
  return new Promise((resolveShard) => {
    const [command, ...args] = buildCoverageShardCommand(shard, shardCount);
    const proc = spawn('pnpm', ['exec', command, ...args], {
      cwd: repoRoot,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    proc.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      process.stdout.write(text);
    });
    proc.stderr.on('data', (data) => {
      const text = data.toString();
      output += text;
      process.stderr.write(text);
    });
    proc.on('close', (code) => resolveShard({ shard, code: code ?? 1, output }));
  });
}

async function runMerge() {
  return await new Promise((resolveMerge) => {
    const proc = spawn('pnpm', ['vitest', '--merge-reports', '--coverage'], {
      cwd: repoRoot,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    proc.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      process.stdout.write(text);
    });
    proc.stderr.on('data', (data) => {
      const text = data.toString();
      output += text;
      process.stderr.write(text);
    });
    proc.on('close', (code) => {
      resolveMerge({ code: code ?? 1, output });
    });
  });
}

function normalizeIgnoredShardFailures(results) {
  return results.map((result) =>
    shouldIgnoreCoverageShardFailure(result) ? { ...result, code: 0 } : result
  );
}

async function runAllShardsWithKnownRaceRetry(shards) {
  let allOutput = '';
  let lastResults = [];

  for (let attempt = 0; attempt <= KNOWN_RACE_RETRY_LIMIT; attempt += 1) {
    if (attempt > 0) {
      rmSync(join(repoRoot, '.vitest-reports'), CLEANUP_RETRY_OPTIONS);
      rmSync(join(repoRoot, 'coverage'), CLEANUP_RETRY_OPTIONS);
      console.warn(
        `[coverage] Retrying all shards after known Vitest coverage temp-file race (attempt ${attempt}/${KNOWN_RACE_RETRY_LIMIT})`
      );
    }

    const results = await Promise.all(
      Array.from({ length: shards }, (_, index) => runShard(index + 1, shards))
    );
    lastResults = results;
    allOutput += mergeShardOutputs(results);

    const realFailures = results.filter(
      (result) =>
        result.code !== 0 &&
        !shouldRetryCoverageShard(result) &&
        !shouldIgnoreCoverageShardFailure(result)
    );
    if (realFailures.length > 0) {
      return { results, output: allOutput };
    }

    const raceFailures = results.filter(shouldRetryCoverageShard);
    if (raceFailures.length === 0) {
      return { results: normalizeIgnoredShardFailures(results), output: allOutput };
    }
  }

  return { results: normalizeIgnoredShardFailures(lastResults), output: allOutput };
}

async function runCoverageWithKnownRaceRetry(shards) {
  let allOutput = '';
  let lastResults = [];
  let lastMerge = null;

  for (let attempt = 0; attempt <= KNOWN_RACE_RETRY_LIMIT; attempt += 1) {
    if (attempt > 0) {
      rmSync(join(repoRoot, '.vitest-reports'), CLEANUP_RETRY_OPTIONS);
      rmSync(join(repoRoot, 'coverage'), CLEANUP_RETRY_OPTIONS);
      console.warn(
        `[coverage] Retrying coverage shards and merge after known Vitest coverage temp-file race (attempt ${attempt}/${KNOWN_RACE_RETRY_LIMIT})`
      );
    }

    const { results, output } = await runAllShardsWithKnownRaceRetry(shards);
    lastResults = results;
    allOutput += output;

    const failed = results.filter((result) => result.code !== 0);
    if (failed.length > 0) {
      return { results, merge: null, output: allOutput };
    }

    const merge = await runMerge();
    lastMerge = merge;
    allOutput += merge.output;

    if (merge.code === 0 || !shouldRetryCoverageMerge(merge)) {
      return { results, merge, output: allOutput };
    }
  }

  return { results: lastResults, merge: lastMerge, output: allOutput };
}

async function main() {
  const { shards } = parseArgs(process.argv.slice(2));

  rmSync(join(repoRoot, '.vitest-reports'), CLEANUP_RETRY_OPTIONS);
  rmSync(join(repoRoot, 'coverage'), CLEANUP_RETRY_OPTIONS);

  const { results, merge, output } = await runCoverageWithKnownRaceRetry(shards);

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, output);

  const failed = results.filter((result) => result.code !== 0);
  if (failed.length > 0) {
    console.error(
      `\n❌ ${failed.length} coverage shard(s) failed: ${failed.map((r) => r.shard).join(', ')}\n`
    );
    process.exit(1);
  }

  if (merge?.code !== 0) {
    process.exit(merge.code);
  }

  rmSync(join(repoRoot, '.vitest-reports'), CLEANUP_RETRY_OPTIONS);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
