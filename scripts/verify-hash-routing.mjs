#!/usr/bin/env node
/**
 * Hash Routing Verification
 *
 * Ensures apps/web uses HashRouter (required for GCS backend bucket hosting).
 *
 * Algorithm:
 * 1. Read apps/web/src/App.tsx
 * 2. Check for HashRouter import and usage
 * 3. Ensure no BrowserRouter usage
 * 4. Report if HashRouter not found or BrowserRouter detected
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const appTsxPath = join(repoRoot, 'apps', 'web', 'src', 'App.tsx');

console.log('Verifying hash routing in web app...\n');

if (!existsSync(appTsxPath)) {
  console.error('❌ apps/web/src/App.tsx not found');
  process.exit(1);
}

const content = readFileSync(appTsxPath, 'utf8');

const hasHashRouterImport =
  /import\s*\{[^}]*HashRouter[^}]*}\s*from\s*['"]react-router-dom['"]/.test(content);
const hasHashRouterUsage = /<HashRouter[\s>]/.test(content);
const hasBrowserRouter = /BrowserRouter/.test(content);

if (hasBrowserRouter) {
  console.error('❌ FORBIDDEN ROUTER DETECTED\n');
  console.error('apps/web/src/App.tsx uses BrowserRouter.');
  console.error('\nREQUIREMENT: Web app MUST use HashRouter for GCS backend bucket hosting.');
  console.error('Backend buckets do NOT support SPA fallback.\n');
  process.exit(1);
}

if (!hasHashRouterImport || !hasHashRouterUsage) {
  console.error('❌ HASH ROUTER NOT FOUND\n');
  console.error('apps/web/src/App.tsx does not use HashRouter.\n');
  console.error('Expected:');
  console.error('  import { HashRouter } from "react-router-dom";');
  console.error('  <HashRouter>...</HashRouter>\n');
  process.exit(1);
}

console.log('✓ HashRouter import found');
console.log('✓ HashRouter usage found');
console.log('✓ No BrowserRouter detected\n');
process.exit(0);
