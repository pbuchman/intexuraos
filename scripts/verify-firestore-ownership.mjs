#!/usr/bin/env node
/**
 * Firestore Collection Ownership Verification Script
 *
 * Ensures each Firestore collection is accessed by ONLY its owning service.
 * Prevents cross-service collection access violations.
 *
 * Algorithm:
 * 1. Load collection registry from firestore-collections.json
 * 2. Scan all apps in src/infra/firestore directories for TypeScript files
 * 3. Extract collection references via regex patterns
 * 4. Validate each reference against registry ownership
 * 5. Report violations with file/line/collection info
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const registryPath = join(repoRoot, 'firestore-collections.json');
const appsDir = join(repoRoot, 'apps');

// Regex patterns to extract collection names
const PATTERNS = [
  // Pattern 1: const COLLECTION_NAME = 'collection_name'
  { regex: /const\s+\w+\s*=\s*['"`]([a-zA-Z0-9_]+)['"`]/, group: 1 },

  // Pattern 2: .collection('collection_name')
  { regex: /\.collection\(['"`]([a-zA-Z0-9_]+)['"`]\)/, group: 1 },

  // Pattern 3: constructor(collectionName = 'collection_name')
  { regex: /constructor\([^)]*collectionName\s*=\s*['"`]([a-zA-Z0-9_]+)['"`]/, group: 1 },

  // Pattern 4: this.collectionName = 'collection_name'
  { regex: /this\.collectionName\s*=\s*['"`]([a-zA-Z0-9_]+)['"`]/, group: 1 },
];

/**
 * Load collection registry
 */
function loadRegistry() {
  if (!existsSync(registryPath)) {
    console.error(`❌ Registry not found: ${registryPath}`);
    process.exit(1);
  }

  const content = readFileSync(registryPath, 'utf8');
  const registry = JSON.parse(content);

  if (!registry.collections) {
    console.error('❌ Invalid registry format: missing "collections" field');
    process.exit(1);
  }

  return registry.collections;
}

/**
 * Get all TypeScript files in a directory (excluding tests)
 */
function getTypeScriptFiles(dir) {
  const files = [];

  if (!existsSync(dir)) {
    return files;
  }

  try {
    const entries = readdirSync(dir);

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        // Skip test directories
        if (entry === '__tests__' || entry === 'node_modules') {
          continue;
        }
        files.push(...getTypeScriptFiles(fullPath));
      } else if (
        entry.endsWith('.ts') &&
        !entry.endsWith('.test.ts') &&
        !entry.endsWith('.spec.ts')
      ) {
        files.push(fullPath);
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return files;
}

/**
 * Extract collection references from a file
 * Returns: Array of { collection, line, lineNumber }
 */
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

/**
 * Get service name from file path
 * e.g., /apps/notion-service/src/... → notion-service
 */
function getServiceName(filePath) {
  const match = filePath.match(/apps\/([^/]+)\//);
  return match ? match[1] : null;
}

/**
 * Scan all services and validate collection ownership
 */
function scanServices(registry) {
  const services = readdirSync(appsDir).filter((entry) => {
    const fullPath = join(appsDir, entry);
    return statSync(fullPath).isDirectory();
  });

  const violations = [];
  const undeclaredCollections = new Set();
  let totalFiles = 0;
  let totalReferences = 0;

  for (const service of services) {
    const firestoreDir = join(appsDir, service, 'src', 'infra', 'firestore');
    const files = getTypeScriptFiles(firestoreDir);
    totalFiles += files.length;

    for (const file of files) {
      const collections = extractCollections(file);
      totalReferences += collections.length;

      for (const { collection, line, lineNumber } of collections) {
        // Check if collection is in registry
        if (!registry[collection]) {
          undeclaredCollections.add(collection);
          violations.push({
            type: 'UNDECLARED',
            collection,
            service,
            file: file.replace(repoRoot + '/', ''),
            lineNumber,
            line,
          });
          continue;
        }

        // Check if service is the owner
        const owner = registry[collection].owner;
        if (owner !== service) {
          violations.push({
            type: 'CROSS_SERVICE',
            collection,
            owner,
            violator: service,
            file: file.replace(repoRoot + '/', ''),
            lineNumber,
            line,
          });
        }
      }
    }
  }

  return {
    violations,
    undeclaredCollections: Array.from(undeclaredCollections),
    stats: {
      services: services.length,
      files: totalFiles,
      references: totalReferences,
    },
  };
}

// Main execution
console.log('Running Firestore ownership validation...\n');

const registry = loadRegistry();
const collectionCount = Object.keys(registry).length;
console.log(`✓ Loaded registry (${collectionCount} collections)`);

const { violations, undeclaredCollections, stats } = scanServices(registry);
console.log(
  `✓ Scanned ${stats.services} services, ${stats.files} files, ${stats.references} collection references\n`
);

if (violations.length === 0) {
  console.log('✅ NO VIOLATIONS FOUND\n');
  console.log('All Firestore collections are properly isolated.');
  console.log('Each collection is accessed only by its owning service.');
  process.exit(0);
}

// Report violations
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

console.error('═══════════════════════════════════════\n');
console.error('RULE: Each Firestore collection MUST be owned by exactly ONE service.\n');
console.error('See: .claude/CLAUDE.md (Firestore Collections section)');
console.error('See: docs/architecture/firestore-ownership.md\n');

process.exit(1);
