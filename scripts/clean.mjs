#!/usr/bin/env node
/**
 * Workspace clean — remove transient build artifacts.
 *
 * Source-exports policy: no `packages/<pkg>/dist` is consumed at runtime.
 */

import { readdirSync, rmSync, statSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');

function rmIfExists(path) {
  if (existsSync(path)) {
    rmSync(path, { recursive: true, force: true });
    console.log(`  removed ${path.replace(repoRoot + '/', '')}`);
  }
}

function cleanWorkspace(folder) {
  const root = join(repoRoot, folder);
  if (!existsSync(root)) return;
  for (const name of readdirSync(root)) {
    const full = join(root, name);
    if (!statSync(full).isDirectory()) continue;
    rmIfExists(join(full, 'dist'));
    // Some packages nest a dist directory one level deeper.
    for (const inner of readdirSync(full)) {
      const innerPath = join(full, inner);
      if (!statSync(innerPath).isDirectory()) continue;
      if (inner === 'node_modules' || inner === 'src') continue;
      rmIfExists(join(innerPath, 'dist'));
    }
  }
}

console.log('Cleaning build artifacts...');
cleanWorkspace('apps');
cleanWorkspace('packages');
rmIfExists(join(repoRoot, 'node_modules', '.cache'));
console.log('✓ clean complete');
