#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { buildCoverageShardCommand, mergeShardOutputs } from './lib/coverage-sharding.mjs';

const repoRoot = resolve(import.meta.dirname, '..');
const outputPath = join(repoRoot, 'scripts/test-results/test-output.txt');

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
    proc.on('close', (code) => {
      resolveShard({ shard, code: code ?? 1, output });
    });
  });
}

async function runMerge() {
  return await new Promise((resolveMerge) => {
    const proc = spawn('pnpm', ['vitest', '--merge-reports', '--coverage'], {
      cwd: repoRoot,
      env: { ...process.env },
      stdio: 'inherit',
    });
    proc.on('close', (code) => {
      resolveMerge(code ?? 1);
    });
  });
}

async function main() {
  const { shards } = parseArgs(process.argv.slice(2));

  rmSync(join(repoRoot, '.vitest-reports'), { recursive: true, force: true });
  rmSync(join(repoRoot, 'coverage'), { recursive: true, force: true });

  const results = await Promise.all(
    Array.from({ length: shards }, (_, index) => runShard(index + 1, shards))
  );

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, mergeShardOutputs(results));

  const failed = results.filter((result) => result.code !== 0);
  if (failed.length > 0) {
    console.error(
      `\n❌ ${failed.length} coverage shard(s) failed: ${failed.map((r) => r.shard).join(', ')}\n`
    );
    process.exit(1);
  }

  const mergeCode = await runMerge();
  if (mergeCode !== 0) {
    process.exit(mergeCode);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
