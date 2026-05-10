#!/usr/bin/env node
/**
 * Migration File Verification Script
 *
 * Checks filename/metadata conventions and enforces the tracked migration
 * manifest used for immutable history on the default branch.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const defaultRepoRoot = resolve(import.meta.dirname, '..');

function calculateManifestChecksum(filePath) {
  const content = readFileSync(filePath, 'utf8');
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function padId(id) {
  return String(id).padStart(3, '0');
}

function loadManifest(manifestPath, errors) {
  if (!existsSync(manifestPath)) {
    errors.push('Missing migrations/manifest.json');
    return null;
  }

  try {
    const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (!Array.isArray(raw.entries)) {
      errors.push('migrations/manifest.json must contain an entries array');
      return null;
    }
    if (typeof raw.lastReservedId !== 'string' || !/^\d{3}$/.test(raw.lastReservedId)) {
      errors.push('migrations/manifest.json must contain a 3-digit string lastReservedId');
      return null;
    }
    return raw;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`Failed to parse migrations/manifest.json - ${message}`);
    return null;
  }
}

export async function verifyMigrations({ repoRoot = defaultRepoRoot } = {}) {
  const migrationsDir = join(repoRoot, 'migrations');
  const errors = [];
  const warnings = [];

  console.log('Verifying migration files...\n');

  if (!existsSync(migrationsDir)) {
    console.log('No migrations directory found - skipping verification');
    return { errors, warnings, count: 0, exitCode: 0 };
  }

  const manifest = loadManifest(join(migrationsDir, 'manifest.json'), errors);

  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.mjs'))
    .sort();

  const ids = [];
  const migrations = [];

  for (const file of files) {
    const match = file.match(/^(\d{3})_(.+)\.mjs$/);
    if (!match) {
      errors.push(`Invalid filename: ${file} (expected NNN_name.mjs)`);
      continue;
    }

    const [, fileId, name] = match;
    ids.push(parseInt(fileId, 10));

    const filePath = join(migrationsDir, file);
    try {
      const module = await import(pathToFileURL(filePath).href);

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

      migrations.push({ id: fileId, name, file, filePath });
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
      errors.push(`Migration ID gap: expected ${padId(expected)}, found ${padId(actual)}`);
      break;
    }
  }

  if (manifest !== null) {
    const entriesByKey = new Map(
      manifest.entries.map((entry) => [`${entry.id}:${entry.name}`, entry])
    );

    for (const entry of manifest.entries) {
      if (
        typeof entry.id !== 'string' ||
        !/^\d{3}$/.test(entry.id) ||
        typeof entry.name !== 'string' ||
        entry.name.length === 0 ||
        typeof entry.checksum !== 'string'
      ) {
        errors.push(
          'migrations/manifest.json entries must each include string id, name, and checksum fields'
        );
        continue;
      }

      const expectedPath = join(migrationsDir, `${entry.id}_${entry.name}.mjs`);
      if (!existsSync(expectedPath)) {
        errors.push(`Manifest entry points to missing file: ${entry.id}_${entry.name}.mjs`);
      }
    }

    const newMigrations = [];
    for (const migration of migrations) {
      const entry = entriesByKey.get(`${migration.id}:${migration.name}`);
      if (entry === undefined) {
        newMigrations.push(migration);
        continue;
      }

      const actualChecksum = calculateManifestChecksum(migration.filePath);
      if (entry.checksum !== actualChecksum) {
        errors.push(
          `${migration.file}: checksums differ from migrations/manifest.json. Migrations are immutable.`
        );
      }
    }

    const expectedNewId = padId(parseInt(manifest.lastReservedId, 10) + 1);
    if (newMigrations.length > 1) {
      errors.push(
        `Multiple new migrations are not allowed in one change: ${newMigrations.map((m) => m.file).join(', ')}`
      );
    }
    for (const migration of newMigrations) {
      if (migration.id !== expectedNewId) {
        errors.push(
          `New migration ${migration.file} must equal lastReservedId+1=${expectedNewId}.`
        );
      }
    }
  }

  return {
    errors,
    warnings,
    count: files.length,
    exitCode: errors.length > 0 ? 1 : 0,
  };
}

async function main() {
  const { errors, warnings, count, exitCode } = await verifyMigrations();

  console.log(`Found ${count} migration file(s)\n`);

  if (warnings.length > 0) {
    console.log('Warnings:');
    for (const warning of warnings) {
      console.log(`  ⚠ ${warning}`);
    }
    console.log('');
  }

  if (errors.length > 0) {
    console.error('Errors:');
    for (const error of errors) {
      console.error(`  ✗ ${error}`);
    }
    console.error('\n❌ Migration verification failed\n');
    process.exit(exitCode);
  }

  console.log('✅ Migration verification passed\n');
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((error) => {
    console.error('Verification failed:', error.message);
    process.exit(1);
  });
}
