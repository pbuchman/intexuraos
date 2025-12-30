#!/usr/bin/env node
import * as esbuild from 'esbuild';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';

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

console.log(`Built ${service}`);
console.log(
  `External packages (${String(externalPackages.length)}): ${externalPackages.join(', ')}`
);
