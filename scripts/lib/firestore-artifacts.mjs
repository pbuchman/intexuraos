import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function normalizeVectorFields(index) {
  const hasVector = index.fields?.some((f) => f.vectorConfig != null) === true;
  if (!hasVector) return index;

  return {
    ...index,
    fields: index.fields.map((field) => {
      if (field.vectorConfig == null) return field;
      const { order, vectorConfig, ...rest } = field;
      return {
        ...rest,
        vectorConfig: {
          dimension: vectorConfig.dimension,
          flat: {},
        },
      };
    }),
  };
}

export function aggregateIndexes(migrations) {
  const allIndexes = [];
  const allFieldOverrides = [];
  const seenIndexes = new Set();
  const seenOverrides = new Set();

  const removedCollectionGroups = new Set();
  for (const migration of migrations) {
    for (const group of migration.removedCollectionGroups ?? []) {
      removedCollectionGroups.add(group);
    }
  }

  for (const migration of migrations) {
    for (const index of migration.indexes ?? []) {
      const hasVectorField = index.fields?.some((f) => f.vectorConfig != null) === true;
      const realFields = index.fields?.filter((f) => f.fieldPath !== '__name__') ?? [];
      if (realFields.length < 2 && !hasVectorField) {
        continue;
      }
      const normalized = normalizeVectorFields(index);
      const key = JSON.stringify(normalized);
      if (!seenIndexes.has(key)) {
        seenIndexes.add(key);
        allIndexes.push(normalized);
      }
    }

    for (const override of migration.fieldOverrides ?? []) {
      const key = JSON.stringify(override);
      if (!seenOverrides.has(key)) {
        seenOverrides.add(key);
        allFieldOverrides.push(override);
      }
    }
  }

  const filteredIndexes = allIndexes.filter(
    (index) => !removedCollectionGroups.has(index.collectionGroup)
  );
  const filteredFieldOverrides = allFieldOverrides.filter(
    (override) => !removedCollectionGroups.has(override.collectionGroup)
  );

  return { indexes: filteredIndexes, fieldOverrides: filteredFieldOverrides };
}

export function aggregateRules(migrations) {
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

export function generateRulesFile({ functions, collections }) {
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

export async function loadFirestoreMigrations({ repoRoot }) {
  const migrationsDir = join(repoRoot, 'migrations');
  if (!existsSync(migrationsDir)) {
    return [];
  }

  const files = readdirSync(migrationsDir)
    .filter((file) => /^\d{3}_.+\.mjs$/.test(file))
    .sort();

  const migrations = [];
  for (const file of files) {
    const fileUrl = `${pathToFileURL(join(migrationsDir, file)).href}?t=${Date.now()}`;
    const module = await import(fileUrl);
    migrations.push({
      file,
      indexes: module.indexes ?? [],
      fieldOverrides: module.fieldOverrides ?? [],
      removedCollectionGroups: module.removedCollectionGroups ?? [],
      rules: module.rules ?? {},
    });
  }

  return migrations;
}

export function buildAggregatedFirestoreArtifacts(migrations) {
  const indexesData = aggregateIndexes(migrations);
  const rulesData = aggregateRules(migrations);
  const rulesText = generateRulesFile(rulesData);

  return {
    indexesData,
    rulesText,
    stats: {
      indexCount: indexesData.indexes.length,
      collectionCount: Object.keys(rulesData.collections).length,
    },
  };
}

export async function writeAggregatedFirestoreArtifacts({ repoRoot, silent = false }) {
  const migrations = await loadFirestoreMigrations({ repoRoot });
  const { indexesData, rulesText, stats } = buildAggregatedFirestoreArtifacts(migrations);

  writeFileSync(
    join(repoRoot, 'firestore.indexes.json'),
    JSON.stringify(indexesData, null, 2) + '\n'
  );
  writeFileSync(join(repoRoot, 'firestore.rules'), rulesText);

  if (!silent) {
    console.log(`✓ Wrote firestore.indexes.json (${stats.indexCount} indexes)`);
    console.log(`✓ Wrote firestore.rules (${stats.collectionCount} collection rules)`);
  }

  return stats;
}
