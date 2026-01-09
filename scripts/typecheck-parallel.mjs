#!/usr/bin/env node
/**
 * Parallel Typecheck for all workspaces
 *
 * Runs `tsc --noEmit` in parallel across all workspaces that have a typecheck script.
 * Much faster than sequential execution (npm run typecheck --workspaces).
 */

import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const rootDir = resolve(import.meta.dirname, '..');
const packageJsonPath = resolve(rootDir, 'package.json');

// Get all workspace packages
function getWorkspaces() {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const workspaces = packageJson.workspaces ?? [];

  // Expand workspace patterns (apps/*, packages/*)
  const workspaceNames = [];

  for (const pattern of workspaces) {
    if (pattern.endsWith('/*')) {
      // apps/* or packages/*
      const baseDir = pattern.replace('/*', '');
      const basePath = resolve(rootDir, baseDir);

      if (existsSync(basePath)) {
        const dirs = readdirSync(basePath, { withFileTypes: true });
        for (const dir of dirs) {
          if (dir.isDirectory()) {
            const pkgPath = resolve(basePath, dir.name, 'package.json');
            if (existsSync(pkgPath)) {
              const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
              if (pkg.scripts?.typecheck) {
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

// Run typecheck for a single workspace, returning process handle
function typecheckWorkspace(workspaceName, activeProcesses) {
  return new Promise((resolve, reject) => {
    const proc = spawn('npm', ['run', 'typecheck', '--workspace', workspaceName], {
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

// Main execution
(async () => {
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
})();
