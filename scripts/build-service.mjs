#!/usr/bin/env node
import * as esbuild from 'esbuild';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

const service = process.argv[2];
if (!service) {
  console.error('Usage: node scripts/build-service.mjs <service-name>');
  process.exit(1);
}

/**
 * Recursively collect all pnpm dependencies from workspace packages.
 * @intexuraos/* packages are bundled, their pnpm deps must be external.
 */
function collectExternalDeps(pkgName, visited = new Set()) {
  if (visited.has(pkgName)) return new Set();
  visited.add(pkgName);

  if (!pkgName.startsWith('@intexuraos/')) {
    return new Set(); // pnpm package - not our concern
  }

  // Determine package path - check apps first, then workers, then packages
  const shortName = pkgName.replace('@intexuraos/', '');
  const appPath = resolve(rootDir, `apps/${shortName}/package.json`);
  const workerPath = resolve(rootDir, `workers/${shortName}/package.json`);
  let pkgPath = appPath;
  if (!existsSync(appPath)) {
    pkgPath = existsSync(workerPath)
      ? workerPath
      : resolve(rootDir, `packages/${shortName}/package.json`);
  }

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
      // pnpm package - must be external
      externals.add(dep);
    }
  }

  return externals;
}

/**
 * Recursively collect all pnpm dependencies WITH versions from workspace packages.
 * Returns a Map of package name -> version for generating production package.json.
 */
function collectExternalDepsWithVersions(pkgName, visited = new Set()) {
  if (visited.has(pkgName)) return new Map();
  visited.add(pkgName);

  if (!pkgName.startsWith('@intexuraos/')) return new Map();

  const shortName = pkgName.replace('@intexuraos/', '');
  const appPath = resolve(rootDir, `apps/${shortName}/package.json`);
  const workerPath = resolve(rootDir, `workers/${shortName}/package.json`);
  let pkgPath = appPath;
  if (!existsSync(appPath)) {
    pkgPath = existsSync(workerPath)
      ? workerPath
      : resolve(rootDir, `packages/${shortName}/package.json`);
  }

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

// Collect all external pnpm deps (including transitive from workspace packages)
const serviceDeps = collectExternalDeps(`@intexuraos/${service}`);
// Always include infra-otel's deps (OTel preload is built separately for all services)
const otelDeps = collectExternalDeps('@intexuraos/infra-otel');
otelDeps.forEach((dep) => serviceDeps.add(dep));
const externalPackages = [...serviceDeps];

// Detect service directory (apps, workers, or packages)
let serviceDir;
if (existsSync(resolve(rootDir, `apps/${service}/src/index.ts`))) {
  serviceDir = `apps/${service}`;
} else if (existsSync(resolve(rootDir, `workers/${service}/src/index.ts`))) {
  serviceDir = `workers/${service}`;
} else {
  console.error(`ERROR: Cannot find service entry point for ${service}`);
  console.error(`  Checked: apps/${service}/src/index.ts, workers/${service}/src/index.ts`);
  process.exit(1);
}

const result = await esbuild.build({
  entryPoints: [resolve(rootDir, `${serviceDir}/src/index.ts`)],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: resolve(rootDir, `${serviceDir}/dist/index.js`),
  external: externalPackages,
  sourcemap: true,
  mainFields: ['module', 'main'],
  conditions: ['import', 'node'],
  absWorkingDir: rootDir,
  metafile: true,
});

// Detect pnpm packages that were bundled instead of marked external.
// This catches missing dependency declarations that cause runtime errors.
const bundledNpmPackages = new Set();
for (const inputPath of Object.keys(result.metafile.inputs)) {
  const match = inputPath.match(/^node_modules\/(@[^/]+\/[^/]+|[^/]+)/);
  if (match) {
    const pkgName = match[1];
    if (!externalPackages.includes(pkgName)) {
      bundledNpmPackages.add(pkgName);
    }
  }
}

if (bundledNpmPackages.size > 0) {
  console.error('\nERROR: pnpm packages bundled instead of external:');
  for (const pkg of bundledNpmPackages) {
    console.error(`  - ${pkg}`);
  }
  console.error(`\nFix: Add missing packages to ${serviceDir}/package.json dependencies\n`);
  process.exit(1);
}

// Detect external packages that are referenced by the bundle but not
// resolvable from `<serviceDir>/dist/` via Node's module resolution.
//
// This check applies ONLY to services that run `node dist/index.js`
// directly from the source tree (e.g. orchestrator on home-dev systemd),
// where there is no separate `pnpm install` step from the generated
// `dist/package.json`. Cloud Functions / Cloud Run paths are exempt
// because their deploy pipelines run a fresh install inside the deployed
// `dist/`.
//
// For source-tree-run services, every referenced external must be hoisted
// into the service's own `node_modules` tree. Under pnpm strict isolation,
// only direct deps are hoisted — transitive deps from @intexuraos/infra-*
// workspace packages (e.g. `@sentry/node`, `pino-opentelemetry-transport`)
// are NOT symlinked, so Node throws ERR_MODULE_NOT_FOUND at startup.
//
// We scan the bundle source for string-literal references rather than the
// esbuild metafile because the failure mode covers both static imports and
// dynamic targets passed as strings (e.g.
// `pino.transport({ target: 'pino-opentelemetry-transport' })`), which
// never appear in metafile.outputs.imports.

/**
 * Services that run `node dist/index.js` directly from the source tree
 * with no separate install step. Add a service here when it adopts a
 * deploy path that does not run `pnpm install --prod` inside `dist/`.
 */
const SOURCE_TREE_RUN_SERVICES = new Set(['orchestrator']);
function canResolveFrom(pkg, fromDir) {
  let dir = fromDir;
  while (true) {
    if (existsSync(resolve(dir, 'node_modules', pkg, 'package.json'))) return true;
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

if (SOURCE_TREE_RUN_SERVICES.has(service)) {
  const distDir = resolve(rootDir, `${serviceDir}/dist`);
  const distOutputPath = resolve(rootDir, `${serviceDir}/dist/index.js`);
  const bundleSource = readFileSync(distOutputPath, 'utf8');

  // A package is "referenced" if its exact name appears as a quoted string
  // in the bundle. Quoted-only matching avoids substring false positives
  // from unrelated specifiers (e.g. `@sentry/node-foo` matching `@sentry/node`).
  function isReferenced(pkg, source) {
    const patterns = [`"${pkg}"`, `'${pkg}'`, `\`${pkg}\``];
    return patterns.some((p) => source.includes(p));
  }

  const referencedExternals = externalPackages.filter((pkg) => isReferenced(pkg, bundleSource));
  const unresolvable = referencedExternals.filter((pkg) => !canResolveFrom(pkg, distDir));
  if (unresolvable.length > 0) {
    console.error(
      '\nERROR: external packages referenced by dist/index.js not resolvable from dist/:'
    );
    for (const pkg of unresolvable) {
      console.error(`  - ${pkg}`);
    }
    console.error(
      `\nThese packages are referenced by the bundle but pnpm has not symlinked` +
        ` them into ${serviceDir}/node_modules. Under strict isolation, only` +
        ` direct dependencies of the service are hoisted there — transitive` +
        ` deps from @intexuraos/infra-* workspace packages are not.` +
        `\n\nFix: Add the package(s) to ${serviceDir}/package.json dependencies` +
        ` so pnpm symlinks them where Node ESM can resolve them.\n`
    );
    process.exit(1);
  }
}

// Generate production package.json with all pnpm dependencies (including transitive)
const depsWithVersions = collectExternalDepsWithVersions(`@intexuraos/${service}`);
// Always include infra-otel's deps for the OTel preload module
const otelDepsWithVersions = collectExternalDepsWithVersions('@intexuraos/infra-otel');
otelDepsWithVersions.forEach((v, k) => depsWithVersions.set(k, v));
const prodPackageJson = {
  name: `@intexuraos/${service}-prod`,
  version: '1.0.0',
  type: 'module',
  dependencies: Object.fromEntries(depsWithVersions),
};

writeFileSync(
  resolve(rootDir, `${serviceDir}/dist/package.json`),
  JSON.stringify(prodPackageJson, null, 2)
);

// Build OTel preload module (separate entry point for --import flag)
const otelRegisterPath = resolve(rootDir, 'packages/infra-otel/src/register.ts');
if (existsSync(otelRegisterPath)) {
  await esbuild.build({
    entryPoints: [otelRegisterPath],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    outfile: resolve(rootDir, `${serviceDir}/dist/otel-register.js`),
    external: externalPackages,
    sourcemap: true,
    mainFields: ['module', 'main'],
    conditions: ['import', 'node'],
    absWorkingDir: rootDir,
  });
  console.log('Built OTel preload: dist/otel-register.js');
}

console.log(`Built ${service}`);
console.log(
  `External packages (${String(externalPackages.length)}): ${externalPackages.join(', ')}`
);
console.log(`Generated dist/package.json with ${String(depsWithVersions.size)} dependencies`);
