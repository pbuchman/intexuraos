#!/usr/bin/env node
/**
 * Parallel Typecheck for all workspaces
 *
 * Runs `tsc --noEmit` in parallel across all workspaces that have a typecheck script.
 * Much faster than sequential execution (pnpm run typecheck --workspaces).
 */

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { discoverWorkspaceNames } from './lib/workspace-discovery.mjs';

const rootDir = resolve(import.meta.dirname, '..');
const WORKSPACE_PATTERNS = ['apps/*', 'packages/*', 'workers/*', 'tools/intex-agent-evals'];

// Get all workspace packages
function getWorkspaces() {
  return discoverWorkspaceNames(rootDir, WORKSPACE_PATTERNS, 'typecheck');
}

export function typecheckCommandArgs(workspaceName) {
  return ['--filter', workspaceName, 'run', 'typecheck'];
}

// Run typecheck for a single workspace, returning process handle
function typecheckWorkspace(workspaceName, activeProcesses) {
  return new Promise((resolve, reject) => {
    const proc = spawn('pnpm', typecheckCommandArgs(workspaceName), {
      stdio: 'inherit',
    });

    activeProcesses.push(proc);

    proc.on('close', (code) => {
      // Remove from active list
      const idx = activeProcesses.indexOf(proc);
      if (idx !== -1) activeProcesses.splice(idx, 1);

      if (code !== 0) {
        reject(new Error(`${workspaceName} typecheck failed`));
      } else {
        resolve();
      }
    });
  });
}

async function main() {
  try {
    const workspaces = getWorkspaces();
    const activeProcesses = [];

    console.log(`Running typecheck for ${workspaces.length} workspaces in parallel...\n`);

    try {
      await Promise.all(workspaces.map((ws) => typecheckWorkspace(ws, activeProcesses)));
    } catch (error) {
      // Kill remaining processes on failure
      for (const proc of activeProcesses) {
        proc.kill('SIGTERM');
      }
      throw error;
    }

    console.log('\n✅ All typechecks passed\n');
    process.exit(0);
  } catch (error) {
    console.error(`\n❌ Typecheck failed: ${error.message}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
