#!/usr/bin/env node
/**
 * Migration File Verification Script
 *
 * Verifies migration files follow required format and naming conventions.
 * Runs as part of CI to catch issues before deployment.
 *
 * Checks:
 * 1. Files match naming pattern: NNN_name.mjs (e.g., 001_initial-setup.mjs)
 * 2. IDs are sequential with no gaps (001, 002, 003, ...)
 * 3. Each file exports required metadata and up function
 * 4. metadata.id matches filename ID
 */

import { readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const migrationsDir = join(repoRoot, 'migrations');

async function verifyMigrations() {
  console.log('Verifying migration files...\n');

  if (!existsSync(migrationsDir)) {
    console.log('No migrations directory found - skipping verification');
    return { errors: [], warnings: [] };
  }

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.mjs'))
    .sort();

  const errors = [];
  const warnings = [];
  const ids = [];

  for (const file of files) {
    if (file === 'README.md') continue;

    const match = file.match(/^(\d{3})_(.+)\.mjs$/);
    if (!match) {
      errors.push(`Invalid filename: ${file} (expected NNN_name.mjs)`);
      continue;
    }

    const [, fileId, name] = match;
    ids.push(parseInt(fileId, 10));

    const filePath = join(migrationsDir, file);

    try {
      const module = await import(filePath);

      if (!module.metadata) {
        errors.push(`${file}: Missing 'metadata' export`);
      } else {
        if (!module.metadata.id) {
          errors.push(`${file}: metadata.id is required`);
        } else if (module.metadata.id !== fileId) {
          errors.push(
            `${file}: metadata.id '${module.metadata.id}' doesn't match filename ID '${fileId}'`
          );
        }
        if (!module.metadata.name) {
          errors.push(`${file}: metadata.name is required`);
        }
        if (!module.metadata.description) {
          warnings.push(`${file}: metadata.description is recommended`);
        }
      }

      if (typeof module.up !== 'function') {
        errors.push(`${file}: Missing 'up' function export`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${file}: Failed to load module - ${message}`);
    }
  }

  ids.sort((a, b) => a - b);
  for (let i = 0; i < ids.length; i++) {
    const expected = i + 1;
    const actual = ids[i];
    if (actual !== expected) {
      errors.push(
        `Migration ID gap: expected ${String(expected).padStart(3, '0')}, found ${String(actual).padStart(3, '0')}`
      );
      break;
    }
  }

  return { errors, warnings, count: files.length };
}

async function main() {
  const { errors, warnings, count } = await verifyMigrations();

  console.log(`Found ${count} migration file(s)\n`);

  if (warnings.length > 0) {
    console.log('Warnings:');
    for (const w of warnings) {
      console.log(`  ⚠ ${w}`);
    }
    console.log('');
  }

  if (errors.length > 0) {
    console.error('Errors:');
    for (const e of errors) {
      console.error(`  ✗ ${e}`);
    }
    console.error('\n❌ Migration verification failed\n');
    process.exit(1);
  }

  console.log('✅ Migration verification passed\n');
}

main().catch((error) => {
  console.error('Verification failed:', error.message);
  process.exit(1);
});
