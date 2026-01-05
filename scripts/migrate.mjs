#!/usr/bin/env node
/**
 * Firestore Database Migration Runner
 *
 * Runs pending migrations in order by numeric prefix (001, 002, ...).
 * Tracks applied migrations in the `_migrations` Firestore collection.
 *
 * Indexes and rules are defined inline in migrations (indexes[], rules{}) and
 * aggregated into firestore.indexes.json and firestore.rules before deployment.
 *
 * Usage:
 *   node scripts/migrate.mjs                    # Run pending migrations
 *   node scripts/migrate.mjs --status           # Show applied/pending migrations
 *   node scripts/migrate.mjs --dry-run          # Preview without applying
 *   node scripts/migrate.mjs --project <id>     # Target specific project
 *
 * Environment:
 *   INTEXURAOS_GCP_PROJECT_ID - Target project (if --project not specified)
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const repoRoot = resolve(import.meta.dirname, '..');
const migrationsDir = join(repoRoot, 'migrations');
const MIGRATIONS_COLLECTION = '_migrations';

function aggregateIndexes(migrations) {
  const allIndexes = [];
  const seen = new Set();

  for (const migration of migrations) {
    for (const index of migration.indexes ?? []) {
      const key = JSON.stringify(index);
      if (!seen.has(key)) {
        seen.add(key);
        allIndexes.push(index);
      }
    }
  }

  return { indexes: allIndexes, fieldOverrides: [] };
}

function aggregateRules(migrations) {
  const functions = {};
  const collections = {};

  for (const migration of migrations) {
    const rules = migration.rules ?? {};
    if (rules.functions) {
      Object.assign(functions, rules.functions);
    }
    if (rules.collections) {
      Object.assign(collections, rules.collections);
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

function generateFirestoreConfig(migrations) {
  const indexesData = aggregateIndexes(migrations);
  const rulesData = aggregateRules(migrations);

  const indexesPath = join(repoRoot, 'firestore.indexes.json');
  const rulesPath = join(repoRoot, 'firestore.rules');

  writeFileSync(indexesPath, JSON.stringify(indexesData, null, 2) + '\n');
  writeFileSync(rulesPath, generateRulesFile(rulesData));

  return {
    indexCount: indexesData.indexes.length,
    collectionCount: Object.keys(rulesData.collections).length,
  };
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    status: false,
    dryRun: false,
    project: null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--status') {
      options.status = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--project' && args[i + 1]) {
      options.project = args[++i];
    }
  }

  return options;
}

function getProjectId(options) {
  const projectId = options.project || process.env['INTEXURAOS_GCP_PROJECT_ID'];
  if (!projectId) {
    console.error('ERROR: Project ID required via --project or INTEXURAOS_GCP_PROJECT_ID');
    process.exit(1);
  }
  return projectId;
}

function initFirestore(projectId) {
  if (getApps().length === 0) {
    initializeApp({
      credential: applicationDefault(),
      projectId,
    });
  }
  return getFirestore();
}

function calculateChecksum(filePath) {
  const content = readFileSync(filePath, 'utf8');
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

async function discoverMigrations() {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.match(/^\d{3}_.*\.mjs$/))
    .sort();

  const migrations = [];
  for (const file of files) {
    const filePath = join(migrationsDir, file);
    const match = file.match(/^(\d{3})_(.+)\.mjs$/);
    if (!match) continue;

    const module = await import(filePath);
    if (!module.metadata || typeof module.up !== 'function') {
      console.error(`ERROR: Invalid migration file ${file} - missing metadata or up function`);
      process.exit(1);
    }

    migrations.push({
      id: match[1],
      name: match[2],
      file,
      filePath,
      checksum: calculateChecksum(filePath),
      metadata: module.metadata,
      up: module.up,
      indexes: module.indexes ?? [],
      rules: module.rules ?? {},
    });
  }

  return migrations;
}

async function getAppliedMigrations(firestore) {
  const snapshot = await firestore.collection(MIGRATIONS_COLLECTION).get();
  const applied = new Map();
  snapshot.forEach((doc) => {
    applied.set(doc.id, doc.data());
  });
  return applied;
}

function runFirebaseCli(args, projectId) {
  return new Promise((resolve, reject) => {
    const firebaseBin = join(repoRoot, 'node_modules', '.bin', 'firebase');
    const proc = spawn(firebaseBin, [...args, `--project=${projectId}`, '--non-interactive'], {
      stdio: 'inherit',
      cwd: repoRoot,
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Firebase CLI exited with code ${code}`));
      } else {
        resolve();
      }
    });
  });
}

async function runMigration(migration, firestore, projectId, dryRun, allMigrations) {
  const startTime = Date.now();

  const context = {
    firestore,
    projectId,
    repoRoot,
    deployIndexes: async () => {
      console.log('  Generating firestore.indexes.json from migrations...');
      const stats = generateFirestoreConfig(allMigrations);
      console.log(`    Aggregated ${stats.indexCount} indexes`);

      if (dryRun) {
        console.log('  [DRY-RUN] Would deploy Firestore indexes');
        return;
      }
      await runFirebaseCli(['deploy', '--only', 'firestore:indexes'], projectId);
    },
    deployRules: async () => {
      console.log('  Generating firestore.rules from migrations...');
      const stats = generateFirestoreConfig(allMigrations);
      console.log(`    Aggregated ${stats.collectionCount} collection rules`);

      if (dryRun) {
        console.log('  [DRY-RUN] Would deploy Firestore rules');
        return;
      }
      await runFirebaseCli(['deploy', '--only', 'firestore:rules'], projectId);
    },
  };

  try {
    await migration.up(context);

    const durationMs = Date.now() - startTime;

    if (!dryRun) {
      await firestore.collection(MIGRATIONS_COLLECTION).doc(migration.id).set({
        id: migration.id,
        name: migration.name,
        status: 'applied',
        appliedAt: new Date().toISOString(),
        durationMs,
        checksum: migration.checksum,
      });
    }

    return { success: true, durationMs };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (!dryRun) {
      await firestore.collection(MIGRATIONS_COLLECTION).doc(migration.id).set({
        id: migration.id,
        name: migration.name,
        status: 'failed',
        appliedAt: new Date().toISOString(),
        durationMs,
        checksum: migration.checksum,
        error: errorMessage,
      });
    }

    return { success: false, durationMs, error: errorMessage };
  }
}

async function showStatus(migrations, applied) {
  console.log('\nMigration Status\n');
  console.log('ID  | Name                        | Status    | Applied At');
  console.log('----|-----------------------------|-----------|--------------------------');

  for (const m of migrations) {
    const record = applied.get(m.id);
    const status = record ? record.status : 'pending';
    const appliedAt = record?.appliedAt ?? '-';
    console.log(`${m.id} | ${m.name.padEnd(27)} | ${status.padEnd(9)} | ${appliedAt}`);
  }

  console.log('');
}

async function main() {
  const options = parseArgs();
  const projectId = getProjectId(options);

  console.log(`\nFirestore Migration Runner`);
  console.log(`Project: ${projectId}`);
  if (options.dryRun) console.log('[DRY-RUN MODE]');
  console.log('');

  const firestore = initFirestore(projectId);
  const migrations = await discoverMigrations();
  const applied = await getAppliedMigrations(firestore);

  if (options.status) {
    await showStatus(migrations, applied);
    return;
  }

  const checksumErrors = [];
  for (const migration of migrations) {
    const record = applied.get(migration.id);
    if (record && record.status === 'applied' && record.checksum) {
      if (record.checksum !== migration.checksum) {
        checksumErrors.push({
          id: migration.id,
          name: migration.name,
          storedChecksum: record.checksum,
          currentChecksum: migration.checksum,
        });
      }
    }
  }

  if (checksumErrors.length > 0) {
    console.error('\nERROR: Applied migrations have been modified!\n');
    for (const err of checksumErrors) {
      console.error(`  ${err.id}_${err.name}`);
      console.error(`    Stored:  ${err.storedChecksum}`);
      console.error(`    Current: ${err.currentChecksum}`);
    }
    console.error('\nApplied migrations must not be modified. Options:');
    console.error('  1. Revert the changes to the migration file');
    console.error('  2. Create a new migration for the intended changes\n');
    process.exit(1);
  }

  const pending = migrations.filter((m) => {
    const record = applied.get(m.id);
    return !record || record.status !== 'applied';
  });

  if (pending.length === 0) {
    console.log('No pending migrations');
    return;
  }

  console.log(`Found ${pending.length} pending migration(s)\n`);

  for (const migration of pending) {
    console.log(`Running ${migration.id}_${migration.name}...`);

    const result = await runMigration(migration, firestore, projectId, options.dryRun, migrations);

    if (result.success) {
      console.log(`  ✓ Completed in ${result.durationMs}ms\n`);
    } else {
      console.error(`  ✗ Failed: ${result.error}\n`);
      process.exit(1);
    }
  }

  console.log('All migrations completed successfully');
}

main().catch((error) => {
  console.error('Migration runner failed:', error.message);
  process.exit(1);
});
