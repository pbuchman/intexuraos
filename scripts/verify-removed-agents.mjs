#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const REMOVED_PATHS = [
  'apps/commands-agent',
  'apps/actions-agent',
  'docs/services/commands-agent',
  'docs/services/actions-agent',
  'packages/internal-clients/src/commands-agent',
  'packages/internal-clients/src/actions-agent',
  'packages/http-contracts/src/zod/commands-agent.ts',
];

const SEARCH_ROOTS = [
  'apps',
  'docker',
  'packages',
  'terraform',
  'scripts',
  'tools',
  'workers',
  'docs',
  'README.md',
  'CHANGELOG.md',
  'ecosystem.config.cjs',
  'ecosystem.config.prod.cjs',
  'ecosystem.generated.cjs',
  'eslint.config.js',
  'firestore-collections.json',
  'firestore.indexes.json',
  'vitest.setup.ts',
  'pnpm-lock.yaml',
];

const IGNORE_PATH_PREFIXES = [
  '.git/',
  'docs/plans/',
  'docs/evidence/',
  'docs/reviews/',
  'docs/designs/',
  'docs/superpowers/',
];

const IGNORE_PATH_SEGMENTS = new Set(['node_modules', 'dist', 'coverage', '.terraform']);

const IGNORE_EXACT_PATHS = new Set([
  'docs/claude-plugins-guide.html',
  'docs/architect-review-report.md',
  'docs/documentation-runs.md',
  'docs/features-rewrite-history.md',
  'terraform/hetzner-prod/retired-async-cleanup.tf',
  'scripts/verify-removed-agents.mjs',
  'scripts/__tests__/verify-removed-agents.test.ts',
]);

const REMOVED_PATTERNS = [
  /commands-agent/g,
  /actions-agent/g,
  /COMMANDS_AGENT/g,
  /ACTIONS_AGENT/g,
  /commands_agent/g,
  /actions_agent/g,
  /commands_ingest/g,
  /actions_queue/g,
  /approval_reply/g,
  /commandsAgent/g,
  /actionsAgent/g,
  /Commands Agent/g,
  /Actions Agent/g,
  /commands agent/g,
  /actions agent/g,
  /\/api\/commands/g,
  /\/api\/actions/g,
  /\/internal\/commands/g,
  /\/internal\/actions/g,
  /\/internal\/retry-pending/g,
  /\/internal\/code\/process/g,
  /\/internal\/whatsapp\/pubsub\/transcription-completed/g,
  /command\.ingest/g,
  /approval\.reply/g,
  /commands-ingest/g,
  /approval-reply/g,
  /actions-queue/g,
  /action\.created/g,
  /calendar-preview/g,
  /INTEXURAOS_PUBSUB_ACTIONS_QUEUE/g,
  /INTEXURAOS_PUBSUB_COMMANDS_INGEST_TOPIC/g,
  /INTEXURAOS_PUBSUB_APPROVAL_REPLY_TOPIC/g,
  /commandClassifierPrompt/g,
  /approvalIntentPrompt/g,
  /command-classification/g,
  /approval-intent/g,
  /(?:^|[^A-Za-z0-9_$])collection(?:Group)?\(\s*['"](?:commands|actions|actions_transitions|approval_messages)['"]\s*\)/g,
];

const REMOVED_FIRESTORE_COLLECTION_ROWS = [
  /"collectionGroup"\s*:\s*"commands"/g,
  /"collectionGroup"\s*:\s*"actions"/g,
  /"collectionGroup"\s*:\s*"actions_transitions"/g,
  /"collectionGroup"\s*:\s*"approval_messages"/g,
  /"collection"\s*:\s*"commands"/g,
  /"collection"\s*:\s*"actions"/g,
  /"collection"\s*:\s*"actions_transitions"/g,
  /"collection"\s*:\s*"approval_messages"/g,
  /"name"\s*:\s*"commands"/g,
  /"name"\s*:\s*"actions"/g,
  /"name"\s*:\s*"actions_transitions"/g,
  /"name"\s*:\s*"approval_messages"/g,
];

function parseRoot(argv) {
  const rootIndex = argv.indexOf('--root');
  if (rootIndex === -1) {
    return DEFAULT_ROOT;
  }

  const next = argv[rootIndex + 1];
  if (next === undefined || next.trim() === '') {
    throw new Error('--root requires a path');
  }

  return resolve(next);
}

function isIgnored(relativePath) {
  if (IGNORE_EXACT_PATHS.has(relativePath)) {
    return true;
  }

  if (IGNORE_PATH_PREFIXES.some((prefix) => relativePath.startsWith(prefix))) {
    return true;
  }

  return relativePath.split(/[\\/]+/).some((part) => IGNORE_PATH_SEGMENTS.has(part));
}

function pathHasScannableContent(root, entry) {
  const absolutePath = join(root, entry);
  if (!existsSync(absolutePath) || isIgnored(entry)) {
    return false;
  }

  const stat = statSync(absolutePath);
  if (stat.isFile()) {
    return shouldScanFile(entry);
  }

  if (!stat.isDirectory()) {
    return false;
  }

  return readdirSync(absolutePath).some((child) => {
    const childRelative = join(entry, child);
    return pathHasScannableContent(root, childRelative);
  });
}

function collectFiles(root, entry, files) {
  const absolutePath = join(root, entry);
  if (!existsSync(absolutePath)) {
    return;
  }

  const stat = statSync(absolutePath);
  if (stat.isDirectory()) {
    for (const child of readdirSync(absolutePath)) {
      const childRelative = join(entry, child);
      if (!isIgnored(`${childRelative}/`) && !isIgnored(childRelative)) {
        collectFiles(root, childRelative, files);
      }
    }
    return;
  }

  if (stat.isFile() && shouldScanFile(entry)) {
    files.push(entry);
  }
}

function shouldScanFile(relativePath) {
  if (isIgnored(relativePath)) {
    return false;
  }

  const name = basename(relativePath);
  if (name === 'pnpm-lock.yaml') {
    return true;
  }

  return /\.(cjs|html|json|lua|md|mjs|tf|ts|tsx|yaml|yml)$/.test(name);
}

function findPatternMatches(relativePath, content, patterns) {
  const findings = [];
  const lines = content.split('\n');

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const lineNumber = content.slice(0, match.index).split('\n').length;
      const line = lines[lineNumber - 1]?.trim() ?? '';
      findings.push(`${relativePath}:${lineNumber}: ${line}`);
    }
  }

  return findings;
}

export function findRemovedAgentViolations(root) {
  const violations = [];

  for (const removedPath of REMOVED_PATHS) {
    if (pathHasScannableContent(root, removedPath)) {
      violations.push(`${removedPath}: removed agent path still exists`);
    }
  }

  const files = [];
  for (const entry of SEARCH_ROOTS) {
    collectFiles(root, entry, files);
  }

  for (const relativePath of files) {
    const content = readFileSync(join(root, relativePath), 'utf8');
    violations.push(...findPatternMatches(relativePath, content, REMOVED_PATTERNS));

    if (
      relativePath === 'firestore-collections.json' ||
      relativePath === 'firestore.indexes.json'
    ) {
      violations.push(
        ...findPatternMatches(relativePath, content, REMOVED_FIRESTORE_COLLECTION_ROWS)
      );
    }
  }

  return [...new Set(violations)].sort();
}

function main() {
  const root = parseRoot(process.argv.slice(2));
  const violations = findRemovedAgentViolations(root);
  if (violations.length === 0) {
    console.log('Removed agent verification passed');
    return;
  }

  console.error('Removed agent verification failed:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
