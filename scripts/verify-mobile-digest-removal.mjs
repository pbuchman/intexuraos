#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MOBILE_SOURCE = 'apps/mobile-notifications-service/src';
const MOBILE_PACKAGE = 'apps/mobile-notifications-service/package.json';
const REQUIRED_LAYOUT = [
  [MOBILE_SOURCE, 'directory'],
  [
    'apps/mobile-notifications-service/src/domain/notifications/usecases/createConnection.ts',
    'file',
  ],
  [MOBILE_PACKAGE, 'file'],
  ['packages/internal-clients/src/index.ts', 'file'],
  ['packages/llm-prompts/src/index.ts', 'file'],
];
const HASH_ALLOWLIST = new Map([
  [
    'apps/mobile-notifications-service/src/domain/notifications/usecases/createConnection.ts',
    new Set(["return createHash('sha256').update(signature).digest('hex');"]),
  ],
]);
const RETIRED_PATHS = [
  'packages/internal-clients/src/mobile-notifications-service',
  'packages/llm-prompts/src/digest',
];
const RETIRED_DEPENDENCIES = [
  '@intexuraos/infra-pubsub',
  '@intexuraos/llm-factory',
  '@intexuraos/llm-pricing',
  '@intexuraos/llm-prompts',
  '@intexuraos/whatsapp-pubsub-client',
];
const RETIRED_IDENTIFIERS = [
  /messageDigest/i,
  /dailyDigest/i,
  /digestRoutes/i,
  /backfill/i,
  /groupMessages/i,
  /group-messages/i,
  /group_messages/i,
  /mobile_daily_summaries/i,
  /mobile_group_states/i,
  /mobile_digest_locks/i,
  /mobile_digest_backfill_runs/i,
  /grupa-wedkarska-skool/i,
  /DIGEST_LLM/i,
  /whatsapp-pubsub-client/i,
  /PUBSUB_WHATSAPP_SEND/i,
];

function parseRoot(argv) {
  const rootIndex = argv.indexOf('--root');
  if (rootIndex === -1) return DEFAULT_ROOT;
  const value = argv[rootIndex + 1];
  if (value === undefined || value.trim() === '' || value.startsWith('--')) {
    throw new Error('--root requires a directory path');
  }
  return resolve(value);
}

function validateRequiredLayout(root) {
  if (!existsSync(root)) {
    return [`${root}: repository root is required`];
  }
  if (!statSync(root).isDirectory()) {
    return [`${root}: repository root must be a directory`];
  }

  const violations = [];
  for (const [relativePath, kind] of REQUIRED_LAYOUT) {
    const absolutePath = resolve(root, relativePath);
    if (!existsSync(absolutePath)) {
      violations.push(`${relativePath}: required ${kind} is missing`);
      continue;
    }

    const stats = statSync(absolutePath);
    const hasExpectedKind = kind === 'directory' ? stats.isDirectory() : stats.isFile();
    if (!hasExpectedKind) violations.push(`${relativePath}: must be a ${kind}`);
  }
  return violations;
}

function collectActiveSourceFiles(directory, files) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      if (entry === '__tests__' || entry === 'dist' || entry === 'node_modules') continue;
      collectActiveSourceFiles(path, files);
      continue;
    }
    if (!/\.(?:cjs|js|mjs|ts|tsx)$/.test(entry) || /\.(?:spec|test)\.[^.]+$/.test(entry)) {
      continue;
    }
    files.push(path);
  }
}

function collectRetiredFiles(path, files) {
  if (!existsSync(path)) return;
  const stats = statSync(path);
  if (stats.isFile()) {
    files.push(path);
    return;
  }
  if (!stats.isDirectory()) return;
  for (const entry of readdirSync(path)) {
    if (entry === 'dist' || entry === 'node_modules') continue;
    collectRetiredFiles(join(path, entry), files);
  }
}

function scanMobileSource(root) {
  const files = [];
  collectActiveSourceFiles(resolve(root, MOBILE_SOURCE), files);
  const violations = [];

  for (const file of files) {
    const relativePath = relative(root, file);
    const allowedHashLines = HASH_ALLOWLIST.get(relativePath) ?? new Set();
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      const hasRetiredIdentifier = RETIRED_IDENTIFIERS.some((pattern) => pattern.test(line));
      const hasDigest = /digest/i.test(line);
      if ((!hasRetiredIdentifier && !hasDigest) || (hasDigest && allowedHashLines.has(trimmed))) {
        return;
      }
      violations.push(`${relativePath}:${String(index + 1)}: ${trimmed}`);
    });
  }

  return violations;
}

function scanPackage(root) {
  const packagePath = resolve(root, MOBILE_PACKAGE);
  if (!existsSync(packagePath)) return [];
  const parsed = JSON.parse(readFileSync(packagePath, 'utf8'));
  const dependencyNames = new Set([
    ...Object.keys(parsed.dependencies ?? {}),
    ...Object.keys(parsed.devDependencies ?? {}),
  ]);
  return RETIRED_DEPENDENCIES.filter((dependency) => dependencyNames.has(dependency)).map(
    (dependency) => `${MOBILE_PACKAGE}: retired dependency ${dependency}`
  );
}

function scanRetiredPaths(root) {
  const files = [];
  for (const path of RETIRED_PATHS) collectRetiredFiles(resolve(root, path), files);
  return files.map(
    (path) => `${relative(root, path)}: file remains under a retired implementation path`
  );
}

function scanRootExports(root) {
  const checks = [
    ['packages/internal-clients/src/index.ts', './mobile-notifications-service/index.js'],
    ['packages/llm-prompts/src/index.ts', './digest/index.js'],
  ];
  const violations = [];
  for (const [relativePath, retiredExport] of checks) {
    const path = resolve(root, relativePath);
    if (existsSync(path) && readFileSync(path, 'utf8').includes(retiredExport)) {
      violations.push(`${relativePath}: retired export ${retiredExport}`);
    }
  }
  return violations;
}

function main() {
  try {
    const root = parseRoot(process.argv);
    const layoutViolations = validateRequiredLayout(root);
    if (layoutViolations.length > 0) {
      console.error('Mobile digest removal verification failed:');
      for (const violation of layoutViolations) console.error(`  - ${violation}`);
      process.exit(1);
    }

    const violations = [
      ...scanMobileSource(root),
      ...scanPackage(root),
      ...scanRetiredPaths(root),
      ...scanRootExports(root),
    ];

    if (violations.length > 0) {
      console.error('Mobile digest removal verification failed:');
      for (const violation of violations) console.error(`  - ${violation}`);
      process.exit(1);
    }

    console.log('Mobile digest removal verification passed');
  } catch (error) {
    console.error(`Mobile digest removal verification failed: ${String(error)}`);
    process.exit(1);
  }
}

main();
