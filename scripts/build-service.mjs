#!/usr/bin/env node
import * as esbuild from 'esbuild';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

const service = process.argv[2];
if (!service) {
  console.error('Usage: node scripts/build-service.mjs <service-name>');
  process.exit(1);
}

// Packages that must remain external (native modules, etc.)
// These are NOT bundled and must be installed at runtime
const externalPackages = [
  // Google Cloud - has native bindings
  '@google-cloud/*',
  // Sharp - native image processing
  'sharp',
  // Speechmatics - may have native deps
  '@speechmatics/*',
];

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
