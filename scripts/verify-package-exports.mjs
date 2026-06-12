#!/usr/bin/env node
/**
 * Verify the source-exports build policy for all workspace packages.
 *
 * Policy:
 *   - Every package's `exports` map points at `./src/*.ts`. No `dist/`
 *     emission, no `dist/` references in `exports`, no `outDir`/`declaration`
 *     in `tsconfig.json`.
 *
 * Also enforces that:
 *   - Every package directory contains a `README.md`.
 *   - Every package's `README.md` link target `docs/packages/<pkg>/README.md`
 *     exists on disk (catches drift when adding/renaming packages).
 *
 * See `docs/architecture/package-build-output.md` for the full rationale.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { listPackageDirs } from './lib/package-export-utils.mjs';

const repoRoot = resolve(import.meta.dirname, '..');
const packagesRoot = join(repoRoot, 'packages');
const docsPackagesRoot = join(repoRoot, 'docs', 'packages');
const FORBIDDEN_TSCONFIG_KEYS = ['outDir', 'declaration', 'declarationMap'];

/**
 * Recursively flatten an `exports` field into a list of `{ entry, value }`
 * pairs, where `entry` is the dotted export path and `value` is the resolved
 * string. Recurses into objects, expands arrays (Node's fallback form), and
 * skips non-string leaves (e.g. `null` for "not exported").
 */
function flattenExports(node, entry, out) {
  if (typeof node === 'string') {
    out.push({ entry, value: node });
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      flattenExports(child, entry, out);
    }
    return;
  }
  if (node && typeof node === 'object') {
    for (const [key, child] of Object.entries(node)) {
      const nextEntry = entry ? `${entry} -> ${key}` : key;
      flattenExports(child, nextEntry, out);
    }
  }
}

/**
 * Strip `// line` and `/* block *\/` comments from JSON-with-comments so
 * `JSON.parse` can read a TS-style `tsconfig.json`. Conservative — leaves
 * string literals alone.
 */
function stripJsonComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (ch === '"') {
      out += ch;
      i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\' && i + 1 < src.length) {
          out += src[i] + src[i + 1];
          i += 2;
          continue;
        }
        out += src[i++];
      }
      out += src[i++] ?? '';
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

const packageDirs = listPackageDirs(packagesRoot);

const violations = [];
let checkedPackages = 0;

for (const pkgDir of packageDirs) {
  const pkgPath = join(packagesRoot, pkgDir);
  const pkgJsonPath = join(pkgPath, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  const pkgName = pkg.name ?? pkgDir;
  checkedPackages += 1;

  // README presence (all 21 packages must have one).
  if (!existsSync(join(pkgPath, 'README.md'))) {
    violations.push({
      package: pkgName,
      kind: 'missing-readme',
      detail: `packages/${pkgDir}/README.md does not exist`,
    });
  }

  // Long-form docs presence — the package README links here, so it must exist.
  if (!existsSync(join(docsPackagesRoot, pkgDir, 'README.md'))) {
    violations.push({
      package: pkgName,
      kind: 'missing-docs-readme',
      detail: `docs/packages/${pkgDir}/README.md does not exist (linked from packages/${pkgDir}/README.md)`,
    });
  }

  // Exports check — no `./dist/`.
  if (pkg.exports !== undefined) {
    const flat = [];
    flattenExports(pkg.exports, '', flat);
    for (const { entry, value } of flat) {
      if (!value.includes('./dist/')) continue;
      violations.push({
        package: pkgName,
        kind: 'dist-export',
        detail: `exports[${entry || '.'}] = ${JSON.stringify(value)}`,
      });
    }
  }

  // tsconfig check — no `outDir`/`declaration`/`declarationMap`.
  const tsconfigPath = join(pkgPath, 'tsconfig.json');
  if (existsSync(tsconfigPath)) {
    let tsconfig;
    try {
      tsconfig = JSON.parse(stripJsonComments(readFileSync(tsconfigPath, 'utf8')));
    } catch (err) {
      violations.push({
        package: pkgName,
        kind: 'tsconfig-parse',
        detail: `failed to parse packages/${pkgDir}/tsconfig.json: ${err.message}`,
      });
      continue;
    }
    const compilerOptions = tsconfig.compilerOptions ?? {};
    for (const key of FORBIDDEN_TSCONFIG_KEYS) {
      const value = compilerOptions[key];
      if (value === undefined) continue;
      // `declaration: false` and `declarationMap: false` are explicit opt-outs — allow.
      if ((key === 'declaration' || key === 'declarationMap') && value === false) continue;
      violations.push({
        package: pkgName,
        kind: 'tsconfig-emit',
        detail: `packages/${pkgDir}/tsconfig.json compilerOptions.${key} = ${JSON.stringify(value)}`,
      });
    }
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
  console.error('Packages must keep their tsconfig.json at noEmit (no outDir/declaration).');
  console.error('See docs/architecture/package-build-output.md for the full rationale.');
  process.exit(1);
}

console.log(`✓ package-exports verification passed (${checkedPackages} packages checked)`);
console.log('  - All packages export from ./src/*.ts');
console.log('  - No package tsconfig.json emits dist/');
console.log('  - All packages have README.md and matching docs/packages/<pkg>/README.md');
process.exit(0);
