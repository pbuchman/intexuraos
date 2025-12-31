#!/usr/bin/env node
import * as esbuild from 'esbuild';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

const service = process.argv[2];
if (!service) {
  console.error('Usage: node scripts/build-service.mjs <service-name>');
  process.exit(1);
}

/**
 * Recursively collect all npm dependencies from workspace packages.
 * @intexuraos/* packages are bundled, their npm deps must be external.
 */
function collectExternalDeps(pkgName, visited = new Set()) {
  if (visited.has(pkgName)) return new Set();
  visited.add(pkgName);

  if (!pkgName.startsWith('@intexuraos/')) {
    return new Set(); // npm package - not our concern
  }

  // Determine package path - check apps first, then packages
  const shortName = pkgName.replace('@intexuraos/', '');
  const appPath = resolve(rootDir, `apps/${shortName}/package.json`);
  const pkgPath = existsSync(appPath)
    ? appPath
    : resolve(rootDir, `packages/${shortName}/package.json`);

  if (!existsSync(pkgPath)) return new Set();

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const externals = new Set();

  for (const dep of Object.keys(deps)) {
    if (dep.startsWith('@intexuraos/')) {
      // Recurse into workspace package
      const subExternals = collectExternalDeps(dep, visited);
      subExternals.forEach((e) => externals.add(e));
    } else {
      // npm package - must be external
      externals.add(dep);
    }
  }

  return externals;
}

/**
 * Recursively collect all npm dependencies WITH versions from workspace packages.
 * Returns a Map of package name -> version for generating production package.json.
 */
function collectExternalDepsWithVersions(pkgName, visited = new Set()) {
  if (visited.has(pkgName)) return new Map();
  visited.add(pkgName);

  if (!pkgName.startsWith('@intexuraos/')) return new Map();

  const shortName = pkgName.replace('@intexuraos/', '');
  const appPath = resolve(rootDir, `apps/${shortName}/package.json`);
  const pkgPath = existsSync(appPath)
    ? appPath
    : resolve(rootDir, `packages/${shortName}/package.json`);

  if (!existsSync(pkgPath)) return new Map();

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const deps = { ...pkg.dependencies };
  const externals = new Map();

  for (const [dep, version] of Object.entries(deps)) {
    if (dep.startsWith('@intexuraos/')) {
      const subExternals = collectExternalDepsWithVersions(dep, visited);
      subExternals.forEach((v, k) => externals.set(k, v));
    } else {
      externals.set(dep, version);
    }
  }

  return externals;
}

// Collect all external npm deps (including transitive from workspace packages)
const externalPackages = [...collectExternalDeps(`@intexuraos/${service}`)];

await esbuild.build({
  entryPoints: [resolve(rootDir, `apps/${service}/src/index.ts`)],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: resolve(rootDir, `apps/${service}/dist/index.js`),
  external: externalPackages,
  sourcemap: true,
  mainFields: ['module', 'main'],
  conditions: ['import', 'node'],
  absWorkingDir: rootDir,
});

// Generate production package.json with all npm dependencies (including transitive)
const depsWithVersions = collectExternalDepsWithVersions(`@intexuraos/${service}`);
const prodPackageJson = {
  name: `@intexuraos/${service}-prod`,
  version: '1.0.0',
  type: 'module',
  dependencies: Object.fromEntries(depsWithVersions),
};

writeFileSync(
  resolve(rootDir, `apps/${service}/dist/package.json`),
  JSON.stringify(prodPackageJson, null, 2)
);

console.log(`Built ${service}`);
console.log(
  `External packages (${String(externalPackages.length)}): ${externalPackages.join(', ')}`
);
console.log(`Generated dist/package.json with ${String(depsWithVersions.size)} dependencies`);
