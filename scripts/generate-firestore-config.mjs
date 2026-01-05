#!/usr/bin/env node
/**
 * Firestore Config Generator
 *
 * Aggregates indexes and rules from all migrations and generates:
 * - firestore.indexes.json
 * - firestore.rules
 *
 * These files are gitignored - source of truth is migrations/*.mjs.
 *
 * Usage:
 *   node scripts/generate-firestore-config.mjs   # Generate files for local dev/emulator
 */

import { readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const migrationsDir = join(repoRoot, 'migrations');

async function loadMigrations() {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.match(/^\d{3}_.*\.mjs$/))
    .sort();

  const migrations = [];
  for (const file of files) {
    const filePath = join(migrationsDir, file);
    const module = await import(filePath);
    migrations.push({
      file,
      indexes: module.indexes ?? [],
      rules: module.rules ?? {},
    });
  }

  return migrations;
}

function aggregateIndexes(migrations) {
  const allIndexes = [];
  const seen = new Set();

  for (const migration of migrations) {
    for (const index of migration.indexes) {
      const key = JSON.stringify(index);
      if (!seen.has(key)) {
        seen.add(key);
        allIndexes.push(index);
      }
    }
  }

  return {
    indexes: allIndexes,
    fieldOverrides: [],
  };
}

function aggregateRules(migrations) {
  const functions = {};
  const collections = {};

  for (const migration of migrations) {
    if (migration.rules.functions) {
      Object.assign(functions, migration.rules.functions);
    }
    if (migration.rules.collections) {
      Object.assign(collections, migration.rules.collections);
    }
  }

  return { functions, collections };
}

function generateRulesFile({ functions, collections }) {
  const lines = [];

  lines.push("rules_version = '2';");
  lines.push('');
  lines.push('service cloud.firestore {');
  lines.push('  match /databases/{database}/documents {');

  for (const [name, body] of Object.entries(functions)) {
    const params = body.includes('userId') ? '(userId)' : '()';
    lines.push(`    function ${name}${params} {`);
    lines.push(`      ${body}`);
    lines.push('    }');
    lines.push('');
  }

  const collectionEntries = Object.entries(collections);
  const catchAllIndex = collectionEntries.findIndex(([path]) => path.includes('{document=**}'));
  if (catchAllIndex > -1) {
    const [catchAll] = collectionEntries.splice(catchAllIndex, 1);
    collectionEntries.push(catchAll);
  }

  for (const [path, rules] of collectionEntries) {
    if (rules.comment) {
      lines.push(`    // ${rules.comment}`);
    }
    lines.push(`    match /${path} {`);

    if (rules.get) {
      lines.push(`      allow get: if ${rules.get};`);
    }
    if (rules.list) {
      lines.push('');
      if (rules.listComment) {
        lines.push(`      // ${rules.listComment}`);
      }
      lines.push(`      allow list: if ${rules.list};`);
    }
    if (rules.write && (rules.get || rules.list)) {
      lines.push('');
      if (rules.writeComment) {
        lines.push(`      // ${rules.writeComment}`);
      }
      lines.push(`      allow write: if ${rules.write};`);
    }
    if (rules.read !== undefined && !rules.get && !rules.list) {
      lines.push(`      allow read, write: if ${rules.read};`);
    }

    lines.push('    }');
    lines.push('');
  }

  lines.push('  }');
  lines.push('}');

  return lines.join('\n') + '\n';
}

export async function generate(silent = false) {
  if (!silent) console.log('Loading migrations...');
  const migrations = await loadMigrations();

  const migrationsWithIndexes = migrations.filter((m) => m.indexes.length > 0);
  const migrationsWithRules = migrations.filter((m) => Object.keys(m.rules).length > 0);

  if (!silent) {
    console.log(`  Found ${migrationsWithIndexes.length} migration(s) with indexes`);
    console.log(`  Found ${migrationsWithRules.length} migration(s) with rules`);
    console.log('\nAggregating...');
  }

  const indexesData = aggregateIndexes(migrations);
  const rulesData = aggregateRules(migrations);

  if (!silent) {
    console.log(`  Total indexes: ${indexesData.indexes.length}`);
    console.log(`  Total collection rules: ${Object.keys(rulesData.collections).length}`);
  }

  const indexesPath = join(repoRoot, 'firestore.indexes.json');
  const rulesPath = join(repoRoot, 'firestore.rules');

  writeFileSync(indexesPath, JSON.stringify(indexesData, null, 2) + '\n');
  writeFileSync(rulesPath, generateRulesFile(rulesData));

  if (!silent) {
    console.log('\n✓ Generated firestore.indexes.json');
    console.log('✓ Generated firestore.rules');
  }

  return {
    indexCount: indexesData.indexes.length,
    collectionCount: Object.keys(rulesData.collections).length,
  };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  generate().catch((error) => {
    console.error('Generator failed:', error.message);
    process.exit(1);
  });
}
