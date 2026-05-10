#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { maskNonCode } from './verify-incoming-request-logging.mjs';

const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'];
const ROUTE_START_RE = new RegExp(
  String.raw`\b(?:fastify|app)\.(${HTTP_METHODS.join('|')})\s*[<(]`,
  'g'
);
const TARGET_ROUTE_PREFIXES = [
  '/internal/actions',
  '/internal/bookmarks',
  '/internal/calendar/',
  '/internal/code/cancel-with-nonce',
  '/internal/code/group-summary/recompute',
  '/internal/code/process',
  '/internal/code/submit-phase2',
  '/internal/commands',
  '/internal/images',
  '/internal/issues',
  '/internal/linear/',
  '/internal/link-previews',
  '/internal/notion/',
  '/internal/notes',
  '/internal/page-summaries',
  '/internal/research/',
  '/internal/retry-pending',
  '/internal/todos',
  '/internal/usage/',
];

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

function findRouteFiles(root) {
  const appsDir = resolve(root, 'apps');
  const out = [];

  if (!existsSync(appsDir)) {
    return out;
  }

  for (const entry of readdirSync(appsDir)) {
    const routesDir = join(appsDir, entry, 'src', 'routes');
    if (!existsSync(routesDir)) {
      continue;
    }
    walk(routesDir, out);
  }

  return out;
}

function skipGenerics(masked, startIndex) {
  if (masked[startIndex] !== '<') {
    return startIndex;
  }

  let depth = 0;
  let index = startIndex;

  while (index < masked.length) {
    const ch = masked[index];
    if (ch === '<') {
      depth++;
    } else if (ch === '>') {
      depth--;
      if (depth === 0) {
        return index + 1;
      }
    }
    index++;
  }

  return -1;
}

function matchParen(masked, openIndex) {
  if (masked[openIndex] !== '(') {
    return openIndex;
  }

  let depth = 0;
  let index = openIndex;

  while (index < masked.length) {
    const ch = masked[index];
    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0) {
        return index;
      }
    }
    index++;
  }

  return -1;
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

function shouldCheckRoute(routePath) {
  return TARGET_ROUTE_PREFIXES.some((prefix) => routePath.startsWith(prefix));
}

function lineHasAllowComment(lines, lineIndex, marker) {
  if (lineIndex === 0) {
    return false;
  }
  return lines[lineIndex - 1].includes(marker);
}

function inspectRouteSlice(filePath, repoRoot, routePath, source, startLine) {
  const lines = source.split('\n');
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (
      (/reply\.send\s*\(/.test(line) || /reply\.status\s*\([^)]+\)\.send\s*\(/.test(line)) &&
      !lineHasAllowComment(lines, i, '@allow-raw-send')
    ) {
      violations.push(
        `${relative(repoRoot, filePath)}:${String(startLine + i)}: ${routePath} must use reply.ok()/reply.fail() instead of reply.send()`
      );
    }

    if (
      (/return\s*\{\s*success\s*:\s*(true|false)/.test(line) ||
        /return\s*\{\s*error\s*:/.test(line)) &&
      !lineHasAllowComment(lines, i, '@allow-raw-return')
    ) {
      violations.push(
        `${relative(repoRoot, filePath)}:${String(startLine + i)}: ${routePath} must return the standard envelope via reply.ok()/reply.fail()`
      );
    }

    if (
      /return\s*\{\s*$/.test(trimmed) &&
      i + 1 < lines.length &&
      !lineHasAllowComment(lines, i, '@allow-raw-return')
    ) {
      const nextLine = lines[i + 1].trim();
      if (/^(success\s*:|error\s*:)/.test(nextLine)) {
        violations.push(
          `${relative(repoRoot, filePath)}:${String(startLine + i)}: ${routePath} must return the standard envelope via reply.ok()/reply.fail()`
        );
      }
    }
  }

  return violations;
}

function scanFile(filePath, repoRoot) {
  const source = readFileSync(filePath, 'utf8');
  const masked = maskNonCode(source);
  const violations = [];

  ROUTE_START_RE.lastIndex = 0;
  let match;
  while ((match = ROUTE_START_RE.exec(masked)) !== null) {
    let index = match.index + match[0].length - 1;

    if (masked[index] === '<') {
      index = skipGenerics(masked, index);
      if (index === -1) {
        continue;
      }
      while (index < masked.length && masked[index] !== '(') {
        index++;
      }
    }

    if (masked[index] !== '(') {
      continue;
    }

    const closeIndex = matchParen(masked, index);
    if (closeIndex === -1) {
      continue;
    }

    const slice = source.slice(index, closeIndex + 1);
    const pathMatch = slice.match(/\(\s*['"`]([^'"`]+)['"`]/);
    if (!pathMatch) {
      continue;
    }

    const routePath = pathMatch[1];
    if (!shouldCheckRoute(routePath)) {
      continue;
    }

    const startLine = lineNumberOf(source, match.index);
    violations.push(...inspectRouteSlice(filePath, repoRoot, routePath, slice, startLine));
  }

  return violations;
}

function main() {
  try {
    const { root } = parseArgs(process.argv);
    const files = findRouteFiles(root);
    const violations = files.flatMap((filePath) => scanFile(filePath, root));

    if (violations.length > 0) {
      console.error('Envelope verification failed:');
      for (const violation of violations) {
        console.error(`  - ${violation}`);
      }
      process.exit(1);
    }

    console.log(`✓ Internal envelopes verified (${String(files.length)} route files scanned)`);
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

export { findRouteFiles, parseArgs, scanFile, shouldCheckRoute, TARGET_ROUTE_PREFIXES };
