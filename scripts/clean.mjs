#!/usr/bin/env node
/**
 * Workspace clean — remove transient build artifacts.
 *
 * Source-exports policy: no `packages/<pkg>/dist` is consumed at runtime
 * EXCEPT `packages/infra-otel/dist`, which holds the compiled `register.js`
 * loaded by `node --require` at OTel bootstrap. Cleaning that would leave dev
 * shells unable to start until the next
 * `pnpm --filter @intexuraos/infra-otel run build`.
 *
 * This script preserves `infra-otel/dist`. To force a clean rebuild of OTel,
 * delete `packages/infra-otel/dist` manually and rerun the OTel build.
 */

import { readdirSync, rmSync, statSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const PRESERVE = new Set(['infra-otel']);

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
    if (folder === 'packages' && PRESERVE.has(name)) continue;
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

console.log('Cleaning build artifacts (preserving packages/infra-otel/dist)...');
cleanWorkspace('apps');
cleanWorkspace('packages');
rmIfExists(join(repoRoot, 'node_modules', '.cache'));
console.log('✓ clean complete');
