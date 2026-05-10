#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { maskNonCode } from './verify-incoming-request-logging.mjs';

const TARGET_DIRECTORIES = [
  'apps/actions-agent/src/infra/action',
  'apps/actions-agent/src/infra/http',
  'apps/actions-agent/src/infra/research',
  'apps/bookmarks-agent/src/infra/linkpreview',
  'apps/bookmarks-agent/src/infra/summary',
  'apps/code-agent/src/infra/http/linear',
  'apps/commands-agent/src/infra/actionsAgent',
  'apps/linear-agent/src/infra/http',
  'apps/research-agent/src/infra/image',
  'apps/research-agent/src/infra/notion',
  'apps/research-agent/src/infra/usage',
  'apps/whatsapp-service/src/infra/linkpreview',
];

const RAW_FETCH_RE = /\b(?:globalThis\.)?fetch\s*\(/g;

function parseArgs(argv) {
  const args = argv.slice(2);
  let root = resolve(import.meta.dirname, '..');

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root') {
      const next = args[i + 1];
      if (typeof next !== 'string' || next.length === 0 || next.startsWith('--')) {
        throw new Error('--root requires a directory argument');
      }
      root = resolve(next);
      i++;
    }
  }

  return { root };
}

function lineNumberOf(source, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') {
      line++;
    }
  }
  return line;
}

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      if (entry === '__tests__' || entry === 'dist') {
        continue;
      }
      walk(fullPath, out);
      continue;
    }

    if (!entry.endsWith('.ts') || entry.endsWith('.d.ts') || entry.endsWith('.test.ts')) {
      continue;
    }

    out.push(fullPath);
  }
}

function findTargetFiles(root) {
  const files = [];

  for (const relativeDir of TARGET_DIRECTORIES) {
    const dir = resolve(root, relativeDir);
    if (!existsSync(dir)) {
      continue;
    }
    walk(dir, files);
  }

  return files;
}

function scanFile(filePath, repoRoot) {
  const source = readFileSync(filePath, 'utf8');
  const masked = maskNonCode(source);
  const violations = [];

  RAW_FETCH_RE.lastIndex = 0;
  let match;
  while ((match = RAW_FETCH_RE.exec(masked)) !== null) {
    const line = lineNumberOf(source, match.index);
    violations.push(
      `${relative(repoRoot, filePath)}:${String(line)}: raw fetch() is forbidden here`
    );
  }

  return violations;
}

function main() {
  try {
    const { root } = parseArgs(process.argv);
    const files = findTargetFiles(root);
    const violations = files.flatMap((filePath) => scanFile(filePath, root));

    if (violations.length > 0) {
      console.error('Raw internal fetch verification failed:');
      for (const violation of violations) {
        console.error(`  - ${violation}`);
      }
      console.error('');
      console.error(
        'Use @intexuraos/internal-clients package clients or shared request helpers instead.'
      );
      process.exit(1);
    }

    console.log(`✓ No raw internal fetch calls found (${String(files.length)} files scanned)`);
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename ?? '');

if (invokedDirectly) {
  main();
}

export { findTargetFiles, parseArgs, scanFile, TARGET_DIRECTORIES };
