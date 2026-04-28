#!/usr/bin/env node
/**
 * Incoming Request Logging Verification
 *
 * Scans every Fastify route declaration in `apps/<service>/src/routes/**\/*.ts`
 * and fails CI if any handler does not call `logIncomingRequest(`.
 *
 * Algorithm:
 *   1. Glob `apps/* /src/routes/**\/*.ts` (excluding tests, helpers, schemas, barrels).
 *   2. Mask string/template literals and comments (preserving offsets).
 *   3. For each `fastify.<method>(` route start, skip TS generics (`<...>`)
 *      then balance-paren the route declaration.
 *   4. If the route declaration substring does not contain
 *      `logIncomingRequest(`, record a violation.
 *
 * CLI:
 *   node scripts/verify-incoming-request-logging.mjs            # scan repo root
 *   node scripts/verify-incoming-request-logging.mjs --root DIR # scan custom root
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'];
const ROUTE_START_RE = new RegExp(String.raw`\bfastify\.(${HTTP_METHODS.join('|')})\s*[<(]`, 'g');

const EXEMPT_FILE_NAMES = new Set(['index.ts', 'types.ts', 'schemas.ts']);
const EXEMPT_PATH_SEGMENTS = new Set(['__tests__', '__test-helpers__', 'helpers', 'schemas']);

/**
 * Parse CLI args. Supports `--root DIR`.
 */
function parseArgs(argv) {
  const args = argv.slice(2);
  let root = resolve(import.meta.dirname, '..');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root') {
      const next = args[i + 1];
      if (typeof next !== 'string' || next.length === 0) {
        throw new Error('--root requires a directory argument');
      }
      // Reject `--root --foo` style: the value must not itself be a flag.
      if (next.startsWith('--')) {
        throw new Error('--root requires a non-flag directory argument');
      }
      root = resolve(next);
      i++;
    }
  }
  return { root };
}

/**
 * Recursively walk a directory and collect .ts route files.
 */
function findRouteFiles(rootDir) {
  const out = [];
  const appsDir = join(rootDir, 'apps');
  if (!existsSync(appsDir)) {
    return out;
  }

  for (const app of readdirSync(appsDir)) {
    const appDir = join(appsDir, app);
    if (!existsSync(appDir) || !statSync(appDir).isDirectory()) continue;
    const routesDir = join(appDir, 'src', 'routes');
    if (!existsSync(routesDir)) continue;
    walk(routesDir, out);
  }

  return out;
}

function walk(dir, out) {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (EXEMPT_PATH_SEGMENTS.has(entry)) continue;
      walk(full, out);
      continue;
    }
    if (!entry.endsWith('.ts')) continue;
    if (entry.endsWith('.test.ts')) continue;
    if (entry.endsWith('.d.ts')) continue;
    if (EXEMPT_FILE_NAMES.has(entry)) continue;
    out.push(full);
  }
}

/**
 * Mask string/template literals, line/block comments by replacing their
 * content with spaces (newlines preserved). Delimiter characters are left
 * intact so generic/paren counters can still see them. Inside template
 * `${...}` substitutions, we recurse into normal code masking.
 *
 * Implementation: a single hand-rolled state machine using a context
 * stack. States: code, dq (double-quote), sq (single-quote), tpl
 * (template literal), tplsub (template substitution), block, line.
 *
 * NOTE (INT-1568): Regex literals (`/.../flags`) are NOT masked. This is
 * acceptable because route-handler code paths in this repo do not place
 * regex literals in positions where their `(`, `)`, or `>` characters
 * could confuse the route-declaration scanner (route paths are always
 * string/template literals, never regex literals). If that invariant
 * changes, extend this state machine with a `regex` state.
 */
function maskNonCode(src) {
  const out = new Array(src.length);
  // Stack frames: { state: 'code'|'dq'|'sq'|'tpl'|'block'|'line', braceDepth?: n }
  const stack = [{ state: 'code' }];
  let i = 0;

  function top() {
    return stack[stack.length - 1];
  }

  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    const frame = top();

    if (frame.state === 'code') {
      if (ch === '/' && next === '*') {
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 2;
        stack.push({ state: 'block' });
        continue;
      }
      if (ch === '/' && next === '/') {
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 2;
        stack.push({ state: 'line' });
        continue;
      }
      if (ch === '"') {
        out[i] = ch;
        i++;
        stack.push({ state: 'dq' });
        continue;
      }
      if (ch === "'") {
        out[i] = ch;
        i++;
        stack.push({ state: 'sq' });
        continue;
      }
      if (ch === '`') {
        out[i] = '`';
        i++;
        stack.push({ state: 'tpl' });
        continue;
      }
      // Inside a template substitution we track brace depth so we know
      // when to pop back into the surrounding `tpl` state.
      if (frame.braceDepth !== undefined) {
        if (ch === '{') {
          frame.braceDepth++;
          out[i] = '{';
          i++;
          continue;
        }
        if (ch === '}') {
          frame.braceDepth--;
          out[i] = '}';
          i++;
          if (frame.braceDepth === 0) {
            stack.pop();
          }
          continue;
        }
      }
      out[i] = ch;
      i++;
      continue;
    }

    if (frame.state === 'block') {
      if (ch === '*' && next === '/') {
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 2;
        stack.pop();
        continue;
      }
      out[i] = ch === '\n' ? '\n' : ' ';
      i++;
      continue;
    }

    if (frame.state === 'line') {
      if (ch === '\n') {
        out[i] = '\n';
        i++;
        stack.pop();
        continue;
      }
      out[i] = ' ';
      i++;
      continue;
    }

    if (frame.state === 'dq' || frame.state === 'sq') {
      const quote = frame.state === 'dq' ? '"' : "'";
      if (ch === '\\' && i + 1 < src.length) {
        out[i] = ' ';
        out[i + 1] = src[i + 1] === '\n' ? '\n' : ' ';
        i += 2;
        continue;
      }
      if (ch === quote) {
        out[i] = ch;
        i++;
        stack.pop();
        continue;
      }
      out[i] = ch === '\n' ? '\n' : ' ';
      i++;
      continue;
    }

    if (frame.state === 'tpl') {
      if (ch === '\\' && i + 1 < src.length) {
        out[i] = ' ';
        out[i + 1] = src[i + 1] === '\n' ? '\n' : ' ';
        i += 2;
        continue;
      }
      if (ch === '`') {
        out[i] = '`';
        i++;
        stack.pop();
        continue;
      }
      if (ch === '$' && next === '{') {
        out[i] = '$';
        out[i + 1] = '{';
        i += 2;
        // Push a code frame that knows it lives inside a template
        // substitution; brace depth starts at 1 (the '{' we just consumed).
        stack.push({ state: 'code', braceDepth: 1 });
        continue;
      }
      out[i] = ch === '\n' ? '\n' : ' ';
      i++;
      continue;
    }

    // Defensive: unknown state, advance one char.
    out[i] = ch;
    i++;
  }

  return out.join('');
}

/**
 * Skip over a TypeScript generic args block starting at '<'.
 * Returns the index of the character AFTER the matching '>', or -1 if
 * the angle brackets cannot be balanced (likely an unterminated generic
 * caused by a malformed string/comment that masking failed to handle).
 */
function skipGenerics(masked, startIdx) {
  if (masked[startIdx] !== '<') return startIdx;
  let depth = 0;
  let i = startIdx;
  while (i < masked.length) {
    const ch = masked[i];
    if (ch === '<') depth++;
    else if (ch === '>') {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return -1;
}

/**
 * Find the matching close ')' for the '(' at openIdx in the masked source.
 * Returns -1 if the parens cannot be balanced (likely an unterminated
 * string/comment/generic that masking failed to handle).
 */
function matchParen(masked, openIdx) {
  if (masked[openIdx] !== '(') return openIdx;
  let depth = 0;
  let i = openIdx;
  while (i < masked.length) {
    const ch = masked[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

function lineNumberOf(src, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < src.length; i++) {
    if (src[i] === '\n') line++;
  }
  return line;
}

/**
 * Scan a single file for violations.
 */
function scanFile(filePath, repoRoot) {
  const src = readFileSync(filePath, 'utf8');
  const masked = maskNonCode(src);
  const violations = [];
  const rel = relative(repoRoot, filePath);

  ROUTE_START_RE.lastIndex = 0;
  let m;
  while ((m = ROUTE_START_RE.exec(masked)) !== null) {
    const method = m[1];
    const matchEnd = m.index + m[0].length;
    let pos = matchEnd - 1; // points at '<' or '('
    if (masked[pos] === '<') {
      const afterGen = skipGenerics(masked, pos);
      if (afterGen === -1) {
        const line = lineNumberOf(src, m.index);
        violations.push(
          `${rel}:${String(line)}: unable to balance angle brackets in route declaration — possible unterminated string/comment/generic`
        );
        // Cannot continue parsing this route reliably; advance to next match.
        continue;
      }
      pos = afterGen;
      while (pos < masked.length && masked[pos] !== '(') pos++;
    }
    if (masked[pos] !== '(') continue;
    const close = matchParen(masked, pos);
    if (close === -1) {
      const line = lineNumberOf(src, m.index);
      violations.push(
        `${rel}:${String(line)}: unable to balance parens in route declaration — possible unterminated string/comment`
      );
      continue;
    }
    const slice = src.slice(pos, close + 1);

    if (!slice.includes('logIncomingRequest(')) {
      const line = lineNumberOf(src, m.index);
      violations.push(
        `${rel}:${String(line)}: fastify.${method}(...) handler missing logIncomingRequest`
      );
    }
  }

  return violations;
}

function main() {
  const { root } = parseArgs(process.argv);
  const files = findRouteFiles(root);

  const allViolations = [];
  for (const f of files) {
    const v = scanFile(f, root);
    allViolations.push(...v);
  }

  if (allViolations.length > 0) {
    console.log('Incoming request logging verification failed:\n');
    for (const v of allViolations) {
      console.log(`  ${v}`);
    }
    console.log('');
    console.log(
      `Add \`logIncomingRequest(request, { message: '<context>', bodyPreviewLength: <n> })\` near the top of each handler.`
    );
    console.log(
      `Use bodyPreviewLength: 200 for body-bearing methods (POST/PATCH/PUT). Import from '@intexuraos/common-http'.`
    );
    process.exit(1);
  }

  console.log(`✓ Incoming request logging verified (${String(files.length)} route files scanned)`);
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename ?? '');

if (invokedDirectly) {
  main();
}

export { scanFile, findRouteFiles, parseArgs, maskNonCode };
