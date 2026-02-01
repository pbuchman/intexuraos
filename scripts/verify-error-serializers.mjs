#!/usr/bin/env node
/**
 * Verifies that all logger configurations include error serializers.
 *
 * This ensures that Error objects are properly serialized for structured logging,
 * preventing the common issue where `{ error }` produces `{"error":{}}`.
 *
 * Checks:
 * 1. Apps use createAppLogger() (already has serializers built-in)
 * 2. Workers that use pino() directly include serializers config
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const SERIALIZERS_PATTERN = /serializers\s*:/;

function walkDir(dir, callback) {
  if (!existsSync(dir)) return;

  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '__tests__') {
        continue;
      }
      walkDir(fullPath, callback);
    } else if (stat.isFile() && entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      callback(fullPath);
    }
  }
}

function main() {
  const violations = [];

  // Check workers for direct pino() usage without serializers
  const workersDir = join(ROOT, 'workers');
  walkDir(workersDir, (filePath) => {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const relPath = relative(ROOT, filePath);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Skip imports
      if (line.includes('import') && line.includes('pino')) {
        continue;
      }

      // Look for pino( calls
      if (/pino\s*\(/.test(line)) {
        // Check context: look ahead up to 10 lines for serializers config
        const contextLines = lines.slice(i, i + 10).join('\n');

        if (!SERIALIZERS_PATTERN.test(contextLines)) {
          violations.push({
            file: relPath,
            line: i + 1,
            message: 'pino() call without serializers config',
          });
        }
      }
    }
  });

  // Check apps to ensure they use createAppLogger (not pino directly)
  const appsDir = join(ROOT, 'apps');
  walkDir(appsDir, (filePath) => {
    const relPath = relative(ROOT, filePath);

    // Skip web app
    if (relPath.startsWith('apps/web/')) {
      return;
    }

    const content = readFileSync(filePath, 'utf-8');

    // Skip if no pino import
    if (!content.includes("from 'pino'") && !content.includes('from "pino"')) {
      return;
    }

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Skip imports
      if (line.includes('import')) {
        continue;
      }

      // Look for pino() calls that create loggers (not pino.destination, pino.multistream)
      if (
        /\bpino\s*\(/.test(line) &&
        !line.includes('pino.destination') &&
        !line.includes('pino.multistream')
      ) {
        violations.push({
          file: relPath,
          line: i + 1,
          message: 'Direct pino() usage in apps/. Use createAppLogger() instead.',
        });
      }
    }
  });

  // Report results
  if (violations.length > 0) {
    console.error('Error serializer violations found:\n');
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}: ${v.message}`);
    }
    console.error(`\n${violations.length} violation(s) found.`);
    console.error('\nTo fix:');
    console.error(
      '  - Workers: Add serializers: { error: serializeError, err: serializeError } to pino() config'
    );
    console.error(
      '  - Apps: Use createAppLogger() from @intexuraos/infra-sentry instead of pino()'
    );
    process.exit(1);
  }

  console.log('✓ All logger configurations include error serializers');
}

main();
