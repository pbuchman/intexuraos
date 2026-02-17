#!/usr/bin/env node
/**
 * Sentry Logging Verification Script.
 *
 * Ensures all loggers in apps are created with Sentry integration.
 *
 * Problem: Direct pino instantiations create loggers that do not send
 * errors to Sentry, causing errors to be silently lost.
 *
 * Rules:
 * - services.ts files must use createAppLogger
 * - infra files must use createAppLogger
 * - server.ts uses createSentryStream with Fastify (OK)
 * - Tests and packages are exempt
 *
 * Usage: node scripts/verify-sentry-logging.mjs
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const appsDir = join(repoRoot, 'apps');

const errors = [];

/**
 * Find all TypeScript files in a directory recursively.
 */
function findTsFiles(dir, files = []) {
  if (!existsSync(dir)) {
    return files;
  }

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (
      stat.isDirectory() &&
      entry !== 'node_modules' &&
      entry !== 'dist' &&
      entry !== '__tests__'
    ) {
      findTsFiles(fullPath, files);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.d.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Check if a file is exempt from the rule.
 *
 * Exempt files:
 * - server.ts - Uses createSentryStream() with Fastify directly
 * - Test files (in __tests__/)
 * - Packages (packages/*) - Accept Logger interface, don't create
 */
function isExemptFile(filePath) {
  const relativePath = relative(repoRoot, filePath);

  // server.ts uses createSentryStream() with Fastify
  if (relativePath.endsWith('/server.ts')) {
    return true;
  }

  // Test files
  if (relativePath.includes('/__tests__/') || relativePath.endsWith('.test.ts')) {
    return true;
  }

  // Packages don't create loggers, they accept Logger interface
  if (relativePath.startsWith('packages/')) {
    return true;
  }

  return false;
}

/**
 * Check a file for direct pino imports.
 */
function checkFile(filePath) {
  if (isExemptFile(filePath)) {
    return;
  }

  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const relativePath = relative(repoRoot, filePath);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;

    // Skip comment lines
    const trimmedLine = line.trim();
    if (
      trimmedLine.startsWith('//') ||
      trimmedLine.startsWith('/*') ||
      trimmedLine.startsWith('*')
    ) {
      continue;
    }

    // Check for direct pino import (skip type-only imports)
    // Type imports like `import type { Logger } from 'pino'` are OK
    // Value imports like `import pino from 'pino'` are NOT OK
    if (/import\s+.*\s+from\s+['"]pino['"]/.test(line) && !/import\s+type\s+/.test(line)) {
      errors.push(
        `${relativePath}:${lineNumber}: Direct pino import forbidden - use createAppLogger from @intexuraos/infra-sentry`
      );
    }
  }
}

/**
 * Main verification function.
 */
function main() {
  console.log('Verifying Sentry logging integration...\n');

  if (!existsSync(appsDir)) {
    console.log('No apps directory found');
    process.exit(1);
  }

  const apps = readdirSync(appsDir).filter((entry) => statSync(join(appsDir, entry)).isDirectory());

  let filesChecked = 0;

  for (const app of apps) {
    const appDir = join(appsDir, app);
    const srcDir = join(appDir, 'src');

    if (!existsSync(srcDir)) {
      continue;
    }

    const files = findTsFiles(srcDir);

    for (const file of files) {
      checkFile(file);
      filesChecked++;
    }
  }

  console.log(`  Checked ${String(filesChecked)} files\n`);

  if (errors.length > 0) {
    console.log('Errors:');
    for (const error of errors) {
      console.log(`  ✖ ${error}`);
    }
    console.log('');
    console.log(`Sentry logging verification failed with ${String(errors.length)} violation(s).`);
    console.log('');
    console.log('To fix:');
    console.log('  1. Replace direct pino import with:');
    console.log("     import { createAppLogger } from '@intexuraos/infra-sentry';");
    console.log('');
    console.log('  2. Replace pino({ name: "xxx" }) calls with:');
    console.log("     createAppLogger({ name: 'xxx' })");
    console.log('');
    console.log('Why: Direct pino() creates loggers without Sentry integration.');
    console.log('     Errors are silently lost and never reach Sentry monitoring.');
    process.exit(1);
  }

  console.log('✓ All loggers use Sentry integration');
}

main();
