#!/usr/bin/env node
/**
 * Hash Routing Verification
 *
 * Ensures apps/web uses hash routing (required for GCS backend bucket hosting).
 *
 * Algorithm:
 * 1. Read apps/web/src/App.tsx
 * 2. Accept declarative HashRouter or createHashRouter + RouterProvider
 * 3. Ensure no browser-history router usage
 * 4. Report if complete hash-router wiring is not found
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { analyzeHashRouting } from './lib/hash-routing.mjs';

const repoRoot = resolve(import.meta.dirname, '..');
const appTsxPath = join(repoRoot, 'apps', 'web', 'src', 'App.tsx');

console.log('Verifying hash routing in web app...\n');

if (!existsSync(appTsxPath)) {
  console.error('❌ apps/web/src/App.tsx not found');
  process.exit(1);
}

const content = readFileSync(appTsxPath, 'utf8');

const analysis = analyzeHashRouting(content);

if (analysis.browserHistoryRouter) {
  console.error('❌ FORBIDDEN ROUTER DETECTED\n');
  console.error('apps/web/src/App.tsx uses a browser-history router.');
  console.error('\nREQUIREMENT: Web app MUST use hash routing for GCS backend bucket hosting.');
  console.error('Backend buckets do NOT support SPA fallback.\n');
  process.exit(1);
}

if (!analysis.valid) {
  console.error('❌ HASH ROUTER NOT FOUND\n');
  console.error('apps/web/src/App.tsx does not contain complete hash-router wiring.\n');
  console.error('Expected either:');
  console.error('  <HashRouter>...</HashRouter>');
  console.error('or:');
  console.error('  const router = createHashRouter(...);');
  console.error('  <RouterProvider router={router} />\n');
  process.exit(1);
}

console.log(`✓ Complete ${analysis.mode} wiring found`);
console.log('✓ No browser-history router detected\n');
process.exit(0);
