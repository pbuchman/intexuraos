#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, extname, relative } from 'node:path';

const buildRoot = resolve(process.argv[2] ?? 'apps/web/dist');
const scannedExtensions = new Set(['.css', '.html', '.js', '.json', '.mjs', '.webmanifest']);
const forbiddenHtmlPaths = ['/src/', '/@vite/', '/@fs/'];
const violations = [];
let scannedFiles = 0;

function scanDirectory(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      scanDirectory(absolutePath);
      continue;
    }
    if (!entry.isFile()) continue;

    const buildPath = relative(buildRoot, absolutePath);
    if (entry.name.endsWith('.map')) violations.push(`${buildPath}: source map file`);
    if (!scannedExtensions.has(extname(entry.name))) continue;

    scannedFiles += 1;
    const contents = readFileSync(absolutePath, 'utf8');
    if (contents.includes('sourceMappingURL')) {
      violations.push(`${buildPath}: sourceMappingURL`);
    }
    if (entry.name === 'index.html') {
      for (const path of forbiddenHtmlPaths) {
        if (contents.includes(path)) violations.push(`${buildPath}: ${path}`);
      }
    }
  }
}

if (!statSync(buildRoot).isDirectory()) {
  throw new Error(`Web build path is not a directory: ${buildRoot}`);
}
scanDirectory(buildRoot);

if (violations.length > 0) {
  throw new Error(`Unsafe web build:\n${violations.join('\n')}`);
}

process.stdout.write(`Verified ${scannedFiles} static web files\n`);
