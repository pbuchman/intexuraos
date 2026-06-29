#!/usr/bin/env node
/**
 * Parallel Lint for all workspaces
 *
 * Runs `eslint src --max-warnings 0` in batches across all workspaces that have a lint:local script.
 * Uses batched execution to prevent ESLint OOM with strictTypeChecked config.
 *
 * Options:
 *   --sequential  Run workspaces one at a time (useful for debugging or low-memory systems)
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseShardArg, selectShardItems } from './lib/sharding.mjs';

const rootDir = resolve(import.meta.dirname, '..');

// Run 4 workspaces at a time to balance speed vs memory in normal CI.
// ESLint strictTypeChecked mode builds full TS AST for each file.
const DEFAULT_CONCURRENCY = 4;

export function parseLintArgs(rawArgs) {
  const targetPaths = [];
  let sequentialMode = false;
  let shard = null;
  let pathsOnly = false;

  for (const [index, arg] of rawArgs.entries()) {
    if (arg === '--') {
      if (index === 0) {
        continue;
      }
      pathsOnly = true;
      continue;
    }

    if (!pathsOnly && arg === '--sequential') {
      sequentialMode = true;
      continue;
    }

    if (!pathsOnly && arg.startsWith('--shard=')) {
      shard = parseShardArg(arg.slice('--shard='.length));
      continue;
    }

    if (!pathsOnly && arg.startsWith('--')) {
      throw new Error(`Unknown lint flag "${arg}". Pass file paths after --.`);
    }

    targetPaths.push(arg);
  }

  return { sequentialMode, shard, targetPaths };
}

function getConcurrency({ sequentialMode }) {
  const envConcurrency = Number.parseInt(process.env.LINT_CONCURRENCY ?? '', 10);
  const defaultConcurrency = process.env.CODE_WORKER_MODE === '1' ? 1 : DEFAULT_CONCURRENCY;
  const configuredConcurrency =
    Number.isInteger(envConcurrency) && envConcurrency > 0 ? envConcurrency : defaultConcurrency;

  return sequentialMode ? 1 : configuredConcurrency;
}

// Workspace patterns from pnpm-workspace.yaml
const WORKSPACE_PATTERNS = ['apps/*', 'packages/*', 'workers/*'];

// Get all workspace packages
function getWorkspaces() {
  const workspaceNames = [];

  for (const pattern of WORKSPACE_PATTERNS) {
    if (pattern.endsWith('/*')) {
      // apps/* or packages/* or workers/*
      const baseDir = pattern.replace('/*', '');
      const basePath = resolve(rootDir, baseDir);

      if (existsSync(basePath)) {
        const dirs = readdirSync(basePath, { withFileTypes: true });
        for (const dir of dirs) {
          if (dir.isDirectory()) {
            const pkgPath = resolve(basePath, dir.name, 'package.json');
            if (existsSync(pkgPath)) {
              const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
              if (pkg.scripts?.['lint:local']) {
                workspaceNames.push(pkg.name);
              }
            }
          }
        }
      }
    }
  }

  return workspaceNames;
}

// Run lint for a single workspace, returning process handle
function lintWorkspace(workspaceName, activeProcesses) {
  return new Promise((resolve, reject) => {
    const proc = spawn('pnpm', ['--filter', workspaceName, 'run', 'lint:local'], {
      stdio: 'inherit',
    });

    activeProcesses.push(proc);

    proc.on('close', (code) => {
      // Remove from active list
      const idx = activeProcesses.indexOf(proc);
      if (idx !== -1) activeProcesses.splice(idx, 1);

      if (code !== 0) {
        reject(new Error(`${workspaceName} lint failed`));
      } else {
        resolve();
      }
    });
  });
}

function lintTargets(paths) {
  return new Promise((resolve, reject) => {
    const proc = spawn('pnpm', ['exec', 'eslint', ...paths, '--max-warnings', '0'], {
      stdio: 'inherit',
    });

    proc.on('close', (code, signal) => {
      if (code !== 0) {
        reject(new Error(`target lint failed${signal ? ` with ${signal}` : ''}`));
      } else {
        resolve();
      }
    });
  });
}

// Run workspaces in batches to control memory usage
async function runInBatches(workspaces, batchSize, activeProcesses) {
  for (let i = 0; i < workspaces.length; i += batchSize) {
    const batch = workspaces.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(workspaces.length / batchSize);

    console.log(
      `\n🔄 Batch ${batchNum}/${totalBatches}: ${batch.map((w) => w.replace('@intexuraos/', '')).join(', ')}\n`
    );

    await Promise.all(batch.map((ws) => lintWorkspace(ws, activeProcesses)));
  }
}

// Main execution
async function main() {
  try {
    const { sequentialMode, shard, targetPaths } = parseLintArgs(process.argv.slice(2));
    const concurrency = getConcurrency({ sequentialMode });
    const allWorkspaces = getWorkspaces();
    const workspaces = shard ? selectShardItems(allWorkspaces, shard) : allWorkspaces;
    const activeProcesses = [];

    if (targetPaths.length > 0) {
      console.log(`Running lint for target path(s): ${targetPaths.join(', ')}\n`);
      await lintTargets(targetPaths);
      console.log('\n✅ Targeted lint passed\n');
      process.exit(0);
    }

    const modeText = sequentialMode ? 'sequentially' : `in batches of ${concurrency}`;
    const shardText = shard ? ` (shard ${shard.index}/${shard.count})` : '';
    console.log(`Running lint for ${workspaces.length} workspaces${shardText} ${modeText}...\n`);

    if (workspaces.length === 0) {
      console.log('⚠️  No workspaces with lint:local script found\n');
      process.exit(0);
    }

    try {
      if (sequentialMode || concurrency === 1) {
        // Sequential mode - run one at a time
        for (const ws of workspaces) {
          console.log(`\n🔍 Linting ${ws.replace('@intexuraos/', '')}...\n`);
          await lintWorkspace(ws, activeProcesses);
        }
      } else {
        // Batched parallel execution
        await runInBatches(workspaces, concurrency, activeProcesses);
      }
    } catch (error) {
      // Kill remaining processes on failure
      for (const proc of activeProcesses) {
        proc.kill('SIGTERM');
      }
      throw error;
    }

    console.log('\n✅ All lints passed\n');
    process.exit(0);
  } catch (error) {
    console.error(`\n❌ Lint failed: ${error.message}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
