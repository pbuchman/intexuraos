#!/usr/bin/env node
/**
 * Firestore Config Generator
 *
 * Aggregates indexes and rules from all migrations and writes the committed
 * artifacts:
 * - firestore.indexes.json
 * - firestore.rules
 *
 * Usage:
 *   node scripts/generate-firestore-config.mjs
 *   node scripts/migrate.mjs --write-artifacts-only
 */

import { resolve } from 'node:path';

import { writeAggregatedFirestoreArtifacts } from './lib/firestore-artifacts.mjs';

const repoRoot = resolve(import.meta.dirname, '..');

export async function generate(silent = false) {
  if (!silent) {
    console.log('Generating Firestore artifacts from migrations...');
  }

  return await writeAggregatedFirestoreArtifacts({ repoRoot, silent });
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  generate().catch((error) => {
    console.error('Generator failed:', error.message);
    process.exit(1);
  });
}
