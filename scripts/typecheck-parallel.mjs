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

// Run typecheck for a single workspace
function typecheckWorkspace(workspaceName) {
  return new Promise((resolve, reject) => {
    const proc = spawn('npm', ['run', 'typecheck', '--workspace', workspaceName], {
      stdio: 'inherit',
    });

    proc.on('close', (code) => {
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

    console.log(`Running typecheck for ${workspaces.length} workspaces in parallel...\n`);

    // Run all typechecks in parallel
    await Promise.all(workspaces.map((ws) => typecheckWorkspace(ws)));

    console.log('\n✅ All typechecks passed\n');
    process.exit(0);
  } catch (error) {
    console.error(`\n❌ Typecheck failed: ${error.message}\n`);
    process.exit(1);
  }
})();
