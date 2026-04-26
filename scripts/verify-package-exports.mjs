#!/usr/bin/env node
/**
 * Verify the source-exports build policy for all workspace packages.
 *
 * Policy:
 *   - Default: every package's `exports` map points at `./src/*.ts`. No `dist/`
 *     emission, no `dist/` references.
 *   - Single exception: `@intexuraos/infra-otel` ships a compiled `./register`
 *     entry pointing at `./dist/register.js` because OpenTelemetry
 *     auto-instrumentation must be loaded via `node --require` at process
 *     bootstrap (before any TS loader is registered).
 *
 * Also enforces that every package directory contains a `README.md`.
 *
 * See `docs/architecture/package-build-output.md` for the full rationale.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const packagesRoot = join(repoRoot, 'packages');
const OTEL_PACKAGE_NAME = '@intexuraos/infra-otel';

/**
 * Recursively flatten an `exports` field into a list of `{ entry, value }`
 * pairs, where `entry` is the dotted export path and `value` is the resolved
 * string. Skips non-string leaves silently (e.g., `null` for "not exported").
 */
function flattenExports(node, entry, out) {
  if (typeof node === 'string') {
    out.push({ entry, value: node });
    return;
  }
  if (node && typeof node === 'object') {
    for (const [key, child] of Object.entries(node)) {
      const nextEntry = entry ? `${entry} -> ${key}` : key;
      flattenExports(child, nextEntry, out);
    }
  }
}

const packageDirs = readdirSync(packagesRoot)
  .filter((name) => {
    const full = join(packagesRoot, name);
    if (!statSync(full).isDirectory()) return false;
    return existsSync(join(full, 'package.json'));
  })
  .sort();

const violations = [];
let checkedPackages = 0;

for (const pkgDir of packageDirs) {
  const pkgPath = join(packagesRoot, pkgDir);
  const pkgJsonPath = join(pkgPath, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  checkedPackages += 1;

  // README presence check (all 21 packages must have one).
  if (!existsSync(join(pkgPath, 'README.md'))) {
    violations.push({
      package: pkg.name ?? pkgDir,
      kind: 'missing-readme',
      detail: `packages/${pkgDir}/README.md does not exist`,
    });
  }

  // Source-exports check.
  if (pkg.exports === undefined) continue;
  const flat = [];
  flattenExports(pkg.exports, '', flat);
  for (const { entry, value } of flat) {
    if (!value.includes('./dist/')) continue;
    if (pkg.name === OTEL_PACKAGE_NAME) continue;
    violations.push({
      package: pkg.name ?? pkgDir,
      kind: 'dist-export',
      detail: `exports[${entry || '.'}] = ${JSON.stringify(value)}`,
    });
  }
}

if (violations.length > 0) {
  console.error('❌ package-exports policy violations:');
  for (const v of violations) {
    console.error(`  - ${v.package}: ${v.kind}`);
    console.error(`      ${v.detail}`);
  }
  console.error('');
  console.error('Policy: packages must export from ./src/*.ts (source-exports default).');
  console.error(`Only ${OTEL_PACKAGE_NAME} may reference ./dist/ (for the ./register entry).`);
  console.error('See docs/architecture/package-build-output.md for the full rationale.');
  process.exit(1);
}

console.log(`✓ package-exports verification passed (${checkedPackages} packages checked)`);
console.log('  - All non-otel packages export from ./src/*.ts');
console.log('  - All packages have README.md');
process.exit(0);
