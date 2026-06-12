#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildAggregatedFirestoreArtifacts,
  loadFirestoreMigrations,
} from './lib/firestore-artifacts.mjs';

const defaultRepoRoot = resolve(import.meta.dirname, '..');

export async function verifyFirestoreArtifacts({ repoRoot = defaultRepoRoot } = {}) {
  const errors = [];
  const indexesPath = resolve(repoRoot, 'firestore.indexes.json');
  const rulesPath = resolve(repoRoot, 'firestore.rules');

  const migrations = await loadFirestoreMigrations({ repoRoot });
  const { indexesData, rulesText } = buildAggregatedFirestoreArtifacts(migrations);

  const expectedIndexes = JSON.stringify(indexesData, null, 2) + '\n';

  if (!existsSync(indexesPath)) {
    errors.push('Missing committed artifact: firestore.indexes.json');
  } else if (readFileSync(indexesPath, 'utf8') !== expectedIndexes) {
    errors.push(
      'firestore.indexes.json differs from the migration aggregation. Run: node scripts/migrate.mjs --write-artifacts-only'
    );
  }

  if (!existsSync(rulesPath)) {
    errors.push('Missing committed artifact: firestore.rules');
  } else if (readFileSync(rulesPath, 'utf8') !== rulesText) {
    errors.push(
      'firestore.rules differs from the migration aggregation. Run: node scripts/migrate.mjs --write-artifacts-only'
    );
  }

  return {
    errors,
    exitCode: errors.length > 0 ? 1 : 0,
  };
}

async function main() {
  console.log('Verifying committed Firestore artifacts...\n');
  const result = await verifyFirestoreArtifacts();

  if (result.errors.length > 0) {
    console.error('Errors:');
    for (const error of result.errors) {
      console.error(`  ✗ ${error}`);
    }
    console.error('\n❌ Firestore artifact verification failed\n');
    process.exit(1);
  }

  console.log('✅ Firestore artifacts match the migration aggregation\n');
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((error) => {
    console.error('Artifact verification failed:', error.message);
    process.exit(1);
  });
}
