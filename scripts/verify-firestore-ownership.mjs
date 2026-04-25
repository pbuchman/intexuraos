#!/usr/bin/env node
/**
 * Firestore Collection Ownership Verification Script
 *
 * Ensures each Firestore collection is accessed by ONLY its owning service.
 * Prevents cross-service collection access violations.
 *
 * Algorithm:
 * 1. Load collection registry from firestore-collections.json
 * 2. Scan apps/<svc>/src/infra/firestore/, plus any registry-row scanPaths,
 *    plus workers/<owner>/src/, for TypeScript files.
 * 3. Extract collection references via regex patterns.
 * 4. Validate each reference against registry ownership (with subcollection +
 *    indexCollectionGroups aliases).
 * 5. Cross-check firestore.indexes.json against the alias-aware registry to
 *    surface ORPHAN_INDEX violations.
 * 6. Emit dead-row warnings for registry entries with zero references.
 *
 * The script is invoked as a CLI when run directly; the core logic is exported
 * as `runOwnershipCheck({ repoRoot })` so tests can drive it against a temp
 * directory and inspect the returned `{ violations, warnings, exitCode }`.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Regex patterns to extract collection names. Patterns must be specific enough
// to avoid false positives when scanning broad worker / scanPaths trees.
const PATTERNS = [
  // Pattern 1: const FOO_COLLECTION = 'collection_name' (only consts whose
  // identifier mentions "Collection" — guards against unrelated string consts)
  {
    regex:
      /const\s+\w*[Cc][Oo][Ll][Ll][Ee][Cc][Tt][Ii][Oo][Nn]\w*\s*=\s*['"`]([a-zA-Z0-9_-]+)['"`]/,
    group: 1,
  },

  // Pattern 2: .collection('collection_name')
  { regex: /\.collection\(['"`]([a-zA-Z0-9_-]+)['"`]\)/, group: 1 },

  // Pattern 3: constructor(collectionName = 'collection_name')
  { regex: /constructor\([^)]*collectionName\s*=\s*['"`]([a-zA-Z0-9_-]+)['"`]/, group: 1 },

  // Pattern 4: this.collectionName = 'collection_name'
  { regex: /this\.collectionName\s*=\s*['"`]([a-zA-Z0-9_-]+)['"`]/, group: 1 },
];

function loadRegistry(registryPath) {
  if (!existsSync(registryPath)) {
    throw new Error(`Registry not found: ${registryPath}`);
  }

  const content = readFileSync(registryPath, 'utf8');
  const registry = JSON.parse(content);

  if (!registry.collections) {
    throw new Error('Invalid registry format: missing "collections" field');
  }

  return registry.collections;
}

function loadIndexes(indexesPath) {
  if (!existsSync(indexesPath)) {
    return { indexes: [], fieldOverrides: [] };
  }

  const content = readFileSync(indexesPath, 'utf8');
  const parsed = JSON.parse(content);
  return {
    indexes: parsed.indexes ?? [],
    fieldOverrides: parsed.fieldOverrides ?? [],
  };
}

function getTypeScriptFiles(dir, options = {}) {
  const files = [];

  if (!existsSync(dir)) {
    return files;
  }

  const skipScripts = options.skipScripts === true;

  try {
    const entries = readdirSync(dir);

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        if (entry === '__tests__' || entry === 'node_modules' || entry === 'dist') {
          continue;
        }
        // For the workers default scan, skip top-level scripts/ subtrees: these
        // are developer CLIs, not production. Owners that need scripts/ scanned
        // opt in via `scanPaths` (which calls this without skipScripts).
        if (skipScripts && entry === 'scripts') {
          continue;
        }
        files.push(...getTypeScriptFiles(fullPath, options));
      } else if (
        entry.endsWith('.ts') &&
        !entry.endsWith('.test.ts') &&
        !entry.endsWith('.spec.ts')
      ) {
        files.push(fullPath);
      }
    }
  } catch {
    // Directory unreadable - return whatever we collected so far
  }

  return files;
}

function extractCollections(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const collections = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    for (const { regex, group } of PATTERNS) {
      const match = line.match(regex);
      if (match && match[group]) {
        collections.push({
          collection: match[group],
          line: line.trim(),
          lineNumber: i + 1,
        });
      }
    }
  }

  return collections;
}

function getServiceName(filePath) {
  const appsMatch = filePath.match(/apps\/([^/]+)\//);
  if (appsMatch) return appsMatch[1];
  const workersMatch = filePath.match(/workers\/([^/]+)\//);
  if (workersMatch) return workersMatch[1];
  return null;
}

/**
 * Build the alias index used for both code-reference matching and ORPHAN_INDEX
 * checks. Every top-level registry key maps to itself; every subcollection and
 * indexCollectionGroups entry maps to the owning collection.
 */
function buildAliasIndex(registry) {
  const aliasIndex = new Map();

  for (const [name, entry] of Object.entries(registry)) {
    aliasIndex.set(name, name);

    for (const sub of entry.subcollections ?? []) {
      aliasIndex.set(sub, name);
    }
    for (const alias of entry.indexCollectionGroups ?? []) {
      aliasIndex.set(alias, name);
    }
  }

  return aliasIndex;
}

/**
 * Build a Map<owner, Set<absolutePath>> of extra scan paths declared by
 * registry rows. The default per-service scan dir is added separately by the
 * caller, so this only contains the explicit `scanPaths` from the registry.
 */
function buildExtraPathsByOwner(registry, repoRoot) {
  const extra = new Map();

  for (const entry of Object.values(registry)) {
    const owner = entry.owner;
    if (typeof owner !== 'string' || owner.length === 0) continue;
    for (const rel of entry.scanPaths ?? []) {
      const abs = resolve(repoRoot, rel);
      if (!extra.has(owner)) {
        extra.set(owner, new Set());
      }
      extra.get(owner).add(abs);
    }
  }

  return extra;
}

function listDirsIn(parent) {
  if (!existsSync(parent)) return [];
  return readdirSync(parent).filter((entry) => {
    try {
      return statSync(join(parent, entry)).isDirectory();
    } catch {
      return false;
    }
  });
}

export function runOwnershipCheck({ repoRoot }) {
  const registryPath = join(repoRoot, 'firestore-collections.json');
  const indexesPath = join(repoRoot, 'firestore.indexes.json');
  const appsDir = join(repoRoot, 'apps');
  const workersDir = join(repoRoot, 'workers');

  const registry = loadRegistry(registryPath);
  const aliasIndex = buildAliasIndex(registry);
  const extraPathsByOwner = buildExtraPathsByOwner(registry, repoRoot);

  const violations = [];
  const warnings = [];
  const undeclaredCollections = new Set();
  const referenceCounts = new Map();
  let totalFiles = 0;
  let totalReferences = 0;

  // Default scan dirs are intentionally narrow:
  //   - apps:    src/infra/firestore/  (production Firestore code only)
  //   - workers: src/, but the recursive walker skips `scripts/` subtrees so
  //     developer CLI utilities are not treated as production references.
  // Owners that need additional dirs scanned (e.g. apps/code-agent/src/scripts)
  // declare them via `scanPaths` on the relevant registry row.
  const services = [
    ...listDirsIn(appsDir).map((name) => ({
      name,
      defaultDir: join(appsDir, name, 'src', 'infra', 'firestore'),
      skipScriptsInDefault: false,
    })),
    ...listDirsIn(workersDir).map((name) => ({
      name,
      defaultDir: join(workersDir, name, 'src'),
      skipScriptsInDefault: true,
    })),
  ];

  for (const service of services) {
    const extras = extraPathsByOwner.get(service.name);

    const files = [];
    files.push(
      ...getTypeScriptFiles(service.defaultDir, {
        skipScripts: service.skipScriptsInDefault,
      })
    );
    if (extras) {
      for (const dir of extras) {
        files.push(...getTypeScriptFiles(dir));
      }
    }
    totalFiles += files.length;

    for (const file of files) {
      const collections = extractCollections(file);
      totalReferences += collections.length;

      for (const { collection, line, lineNumber } of collections) {
        const ownerCollection = aliasIndex.get(collection);

        if (ownerCollection == null) {
          // Not in registry at all
          undeclaredCollections.add(collection);
          violations.push({
            type: 'UNDECLARED',
            collection,
            service: service.name,
            file: file.replace(repoRoot + '/', ''),
            lineNumber,
            line,
          });
          continue;
        }

        // Track that this registry row has at least one reference
        referenceCounts.set(ownerCollection, (referenceCounts.get(ownerCollection) ?? 0) + 1);

        const owner = registry[ownerCollection].owner;
        if (owner !== service.name) {
          violations.push({
            type: 'CROSS_SERVICE',
            collection,
            owner,
            violator: service.name,
            file: file.replace(repoRoot + '/', ''),
            lineNumber,
            line,
          });
        }
      }
    }
  }

  // ORPHAN_INDEX: any collectionGroup in firestore.indexes.json that doesn't
  // resolve via the alias-aware registry.
  const { indexes, fieldOverrides } = loadIndexes(indexesPath);
  const orphanIndexViolations = [];
  for (const idx of indexes) {
    const group = idx.collectionGroup;
    if (typeof group !== 'string') continue;
    if (!aliasIndex.has(group)) {
      orphanIndexViolations.push({
        type: 'ORPHAN_INDEX',
        collection: group,
        source: 'indexes',
      });
    }
  }
  for (const override of fieldOverrides) {
    const group = override.collectionGroup;
    if (typeof group !== 'string') continue;
    if (!aliasIndex.has(group)) {
      orphanIndexViolations.push({
        type: 'ORPHAN_INDEX',
        collection: group,
        source: 'fieldOverrides',
      });
    }
  }
  violations.push(...orphanIndexViolations);

  // Dead-row warnings
  for (const name of Object.keys(registry)) {
    const count = referenceCounts.get(name) ?? 0;
    if (count === 0) {
      const message = `Registry entry '${name}' has no code references — consider deleting`;
      warnings.push(message);
      console.warn(`⚠ ${message}`);
    }
  }

  const stats = {
    services: services.length,
    files: totalFiles,
    references: totalReferences,
  };

  printReport({
    registrySize: Object.keys(registry).length,
    stats,
    violations,
    undeclaredCollections: Array.from(undeclaredCollections),
    orphanIndexViolations,
  });

  const exitCode = violations.length > 0 ? 1 : 0;
  return { violations, warnings, exitCode, stats };
}

function printReport({
  registrySize,
  stats,
  violations,
  undeclaredCollections,
  orphanIndexViolations,
}) {
  console.log('Running Firestore ownership validation...\n');
  console.log(`✓ Loaded registry (${registrySize} collections)`);
  console.log(
    `✓ Scanned ${stats.services} services, ${stats.files} files, ${stats.references} collection references\n`
  );

  if (violations.length === 0) {
    console.log('✅ NO VIOLATIONS FOUND\n');
    console.log('All Firestore collections are properly isolated.');
    console.log('Each collection is accessed only by its owning service.');
    return;
  }

  console.error('❌ FIRESTORE OWNERSHIP VIOLATIONS DETECTED\n');

  const crossServiceViolations = violations.filter((v) => v.type === 'CROSS_SERVICE');
  const undeclaredViolations = violations.filter((v) => v.type === 'UNDECLARED');

  if (crossServiceViolations.length > 0) {
    console.error('═══ Cross-Service Collection Access ═══\n');
    console.error('These services are accessing collections they do NOT own:\n');

    for (const v of crossServiceViolations) {
      console.error(`  Collection: ${v.collection}`);
      console.error(`  Owner: ${v.owner}`);
      console.error(`  Violator: ${v.violator}`);
      console.error(`  File: ${v.file}:${v.lineNumber}`);
      console.error(`    ${v.line}`);
      console.error('');
      console.error(`  Fix: Remove direct Firestore access. Use service-to-service HTTP API:`);
      console.error(
        `    GET http://${v.owner}/internal/${v.owner.replace(/-service$/, '')}/<resource>`
      );
      console.error('');
    }
  }

  if (undeclaredViolations.length > 0) {
    console.error('═══ Undeclared Collections ═══\n');
    console.error('These collections are used but NOT declared in firestore-collections.json:\n');

    for (const collection of undeclaredCollections) {
      const examples = undeclaredViolations.filter((v) => v.collection === collection);
      const example = examples[0];
      if (example == null) continue;

      console.error(`  Collection: ${collection}`);
      console.error(`  Found in: ${example.service}`);
      console.error(`  File: ${example.file}:${example.lineNumber}`);
      console.error('');
      console.error(`  Fix: Add to firestore-collections.json:`);
      console.error(`    {`);
      console.error(`      "${collection}": {`);
      console.error(`        "owner": "${example.service}",`);
      console.error(`        "description": "..."`);
      console.error(`      }`);
      console.error(`    }`);
      console.error('');
    }
  }

  if (orphanIndexViolations.length > 0) {
    console.error('═══ Orphaned Index Declarations ═══\n');
    console.error('These collectionGroups are declared in firestore.indexes.json but have no');
    console.error(
      'matching registry entry (top-level, subcollection, or indexCollectionGroups alias):\n'
    );

    for (const v of orphanIndexViolations) {
      console.error(`  Collection: ${v.collection}  (source: ${v.source})`);
    }
    console.error('');
    console.error(`  Fix: Add a cleanup migration with removedCollectionGroups: [...] and run`);
    console.error(`    node scripts/migrate.mjs --write-artifacts-only`);
    console.error('');
  }

  console.error('═══════════════════════════════════════\n');
  console.error('RULE: Each Firestore collection MUST be owned by exactly ONE service.\n');
  console.error('See: .claude/CLAUDE.md (Firestore Collections section)');
  console.error('See: docs/architecture/firestore-ownership.md\n');
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const repoRoot = resolve(import.meta.dirname, '..');
  try {
    const { exitCode } = runOwnershipCheck({ repoRoot });
    process.exit(exitCode);
  } catch (err) {
    console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
