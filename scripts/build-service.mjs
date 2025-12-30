#!/usr/bin/env node
import * as esbuild from 'esbuild';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

const service = process.argv[2];
if (!service) {
  console.error('Usage: node scripts/build-service.mjs <service-name>');
  process.exit(1);
}

// Read service's package.json to get its dependencies
const servicePkgPath = resolve(rootDir, `apps/${service}/package.json`);
const servicePkg = JSON.parse(readFileSync(servicePkgPath, 'utf8'));

// All npm dependencies should be external (not bundled)
// Only @intexuraos/* workspace packages are bundled (they export TypeScript source)
const allDeps = [
  ...Object.keys(servicePkg.dependencies || {}),
  ...Object.keys(servicePkg.devDependencies || {}),
];

// Filter out @intexuraos/* packages - those MUST be bundled
// Keep all other npm packages as external
const externalPackages = allDeps.filter((dep) => !dep.startsWith('@intexuraos/'));

await esbuild.build({
  entryPoints: [resolve(rootDir, `apps/${service}/src/index.ts`)],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: resolve(rootDir, `apps/${service}/dist/index.js`),
  external: externalPackages,
  sourcemap: true,
  // Ensure we can resolve workspace packages that export source
  mainFields: ['module', 'main'],
  conditions: ['import', 'node'],
  absWorkingDir: rootDir,
});

console.log(`Built ${service}`);
