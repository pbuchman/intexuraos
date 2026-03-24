#!/usr/bin/env node

import ts from 'typescript';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strict as assert } from 'node:assert';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '..');

const NO_OVERRIDES = process.argv.includes('--no-overrides');

// ============================================================================
// OVERRIDE MECHANISM
// ============================================================================

function loadOverrides() {
  if (NO_OVERRIDES) {
    return { overriddenFiles: new Set(), taskMap: new Map() };
  }

  const overridesPath = resolve(ROOT_DIR, 'v8-ignore-overrides.json');

  if (!existsSync(overridesPath)) {
    return { overriddenFiles: new Set(), taskMap: new Map() };
  }

  const data = JSON.parse(readFileSync(overridesPath, 'utf8'));
  const overriddenFiles = new Set();
  const taskMap = new Map();

  for (const [taskId, entry] of Object.entries(data.overrides ?? {})) {
    for (const file of entry.files ?? []) {
      overriddenFiles.add(file);
      taskMap.set(file, taskId);
    }
  }

  return { overriddenFiles, taskMap };
}

const VALID_CATEGORIES = [
  'ts-type',
  'regex',
  'module-init',
  'async-timing',
  'test-infra',
  'upstream',
  'module-mock',
  'schema',
  'source-map',
  'auth-guard',
];

const V8_LEGACY_KEYWORDS = ['next', 'start', 'stop'];

// ============================================================================
// PHASE B-1: Blocker Keyword Enforcement
// ============================================================================

const BLOCKER_KEYWORDS = [
  'cannot',
  'unable',
  'impossible',
  'always returns',
  'always succeeds',
  'always has',
  'always include',
  'always provided',
  'always defined',
  'no support',
  'not mockable',
  'not reachable',
  'not unit-testable',
  'not tracked',
  'never triggered',
  'no way to',
  'does not expose',
  'unreachable',
  'false positive',
  'guarantees',
  'guard',
  'guaranteed',
  'fallback',
  'defensive',
  'nouncheckedindexedaccess',
  'exactoptionalpropertytypes',
  'narrows',
  'narrowing',
];

const CATEGORY_SPECIFIC_KEYWORDS = {
  'ts-type': [
    'type check',
    'type narrowing',
    'undefined check',
    'null check',
    'type system',
    'nullish coalescing',
    'optional property',
    'spread',
    'conditional',
    'ternary',
  ],
  'module-init': [
    'bootstrap',
    'entry point',
    'cold start',
    'module load',
    'startup',
    'initialized at',
    'esm import',
  ],
  'source-map': ['alignment', 'misattributed'],
  upstream: ['prior check', 'early return', 'validated', 'passthrough'],
  schema: ['zod', 'fastify schema', 'validation'],
  regex: ['capture group', 'regex match'],
};

function validateBlockerKeywords(comments) {
  const errors = [];

  for (const comment of comments) {
    if (comment.type === 'stop') continue;

    const explanation = (comment.explanation ?? '').toLowerCase();
    const categoryKeywords = CATEGORY_SPECIFIC_KEYWORDS[comment.category] ?? [];
    const allKeywords = [...BLOCKER_KEYWORDS, ...categoryKeywords];

    const hasBlocker = allKeywords.some((kw) => explanation.includes(kw));

    if (!hasBlocker) {
      errors.push({
        file: comment.file,
        line: comment.line,
        message:
          `Explanation lacks blocker keyword. ` +
          `Must contain at least one of: ${BLOCKER_KEYWORDS.slice(0, 5).join(', ')}, ... ` +
          `See .claude/reference/coverage-exemptions.md for full list.`,
      });
    }
  }

  return { errors };
}

// ============================================================================
// CATEGORY DETECTORS
// ============================================================================

const CATEGORY_DETECTORS = {
  'ts-type': {
    description: 'TypeScript type narrowing guarantees branch unreachable',
    detect: (sourceCode, commentLine, filePath) => {
      const lines = sourceCode.split('\n');
      const lineIdx = commentLine - 1;
      const searchStart = Math.max(0, lineIdx - 20);
      const searchEnd = Math.min(lines.length, lineIdx + 5);
      const context = lines.slice(searchStart, searchEnd).join('\n');

      // Only actual type-narrowing evidence
      const patterns = [
        /\.length\s*[><=!]+/,
        /\.filter\s*\(/,
        /typeof\s+\w+/,
        /instanceof\s+\w+/,
        /\?\?/,
        /\?\./,
        /!==?\s*null/,
        /===?\s*null/,
        /!==?\s*undefined/,
      ];

      for (const pattern of patterns) {
        if (pattern.test(context)) {
          return { valid: true };
        }
      }

      // Also check if explanation references noUncheckedIndexedAccess
      const commentContent = lines[lineIdx] ?? '';
      if (/noUncheckedIndexedAccess/i.test(commentContent)) {
        return { valid: true };
      }

      return {
        valid: false,
        suggestion:
          'No type-narrowing pattern found. ' +
          'ts-type requires actual TypeScript type system evidence (typeof, instanceof, ??, ?., length check, null/undefined check).',
      };
    },
  },

  regex: {
    description: 'Capture group guaranteed by regex pattern',
    detect: (sourceCode, commentLine) => {
      const lines = sourceCode.split('\n');
      const lineIdx = commentLine - 1;

      // Look for .exec() or .match() call above (within 10 lines)
      let foundRegexCall = false;
      const searchStart = Math.max(0, lineIdx - 10);
      for (let i = searchStart; i < lineIdx; i++) {
        const line = lines[i];
        if (/\.exec\s*\(/.test(line) || /\.match\s*\(/.test(line)) {
          foundRegexCall = true;
          break;
        }
      }

      if (!foundRegexCall) {
        return { valid: false, suggestion: 'No .exec() or .match() call found above' };
      }

      // Look for capture group access with ??
      const currentLine = lines[lineIdx] ?? '';
      const nextLine = lines[lineIdx + 1] ?? '';
      const combined = currentLine + nextLine;

      if (/\w+\[\d+\]\s*\?\?/.test(combined)) {
        return { valid: true };
      }

      return { valid: false, suggestion: 'No capture group access with ?? found near comment' };
    },
  },

  'module-init': {
    description: 'Module-level code runs before tests',
    detect: (sourceCode, commentLine) => {
      // Use TypeScript AST to check if code is at module scope
      const sourceFile = ts.createSourceFile('temp.ts', sourceCode, ts.ScriptTarget.Latest, true);

      const lineIdx = commentLine - 1;

      // Find the node at the comment line
      function findNodeAtLine(node) {
        const startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line;
        const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line;

        if (lineIdx >= startLine && lineIdx <= endLine) {
          return node;
        }

        for (const child of node.getChildren(sourceFile)) {
          const found = findNodeAtLine(child);
          if (found) return found;
        }
        return null;
      }

      const node = findNodeAtLine(sourceFile);
      if (!node) {
        return { valid: false, suggestion: 'Could not find code node at comment line' };
      }

      // Check if node is at module level (not inside function/class)
      let current = node;
      let parent = node.parent;

      while (parent) {
        if (
          parent.kind === ts.SyntaxKind.FunctionDeclaration ||
          parent.kind === ts.SyntaxKind.ArrowFunction ||
          parent.kind === ts.SyntaxKind.FunctionExpression ||
          parent.kind === ts.SyntaxKind.MethodDeclaration ||
          parent.kind === ts.SyntaxKind.ClassDeclaration ||
          (parent.kind === ts.SyntaxKind.Block && current.kind !== ts.SyntaxKind.SourceFile)
        ) {
          return { valid: false, suggestion: 'Code is inside a function, class, or block' };
        }
        current = parent;
        parent = parent.parent;
      }

      return { valid: true };
    },
  },

  'async-timing': {
    description: 'Callback cancelled before it fires in tests',
    detect: (sourceCode, commentLine) => {
      const lines = sourceCode.split('\n');
      const lineIdx = commentLine - 1;

      // Look for setTimeout/setInterval and clearTimeout/clearInterval in same function
      // Search in a reasonable window around the comment
      const searchStart = Math.max(0, lineIdx - 20);
      const searchEnd = Math.min(lines.length, lineIdx + 10);

      let foundTimeout = false;
      let foundClear = false;

      for (let i = searchStart; i < searchEnd; i++) {
        const line = lines[i];
        if (/setTimeout|setInterval/.test(line)) {
          foundTimeout = true;
        }
        if (/clearTimeout|clearInterval/.test(line)) {
          foundClear = true;
        }
      }

      if (foundTimeout && foundClear) {
        return { valid: true };
      }

      return {
        valid: false,
        suggestion: 'Need both setTimeout/setInterval and clearTimeout/clearInterval in same scope',
      };
    },
  },

  'test-infra': {
    description: 'Fake/mock cannot produce required state',
    detect: (sourceCode, commentLine, filePath) => {
      const lines = sourceCode.split('\n');
      const lineIdx = commentLine - 1;
      const searchStart = Math.max(0, lineIdx - 15);
      const searchEnd = Math.min(lines.length, lineIdx + 10);
      const context = lines.slice(searchStart, searchEnd).join('\n');

      // Only genuinely untestable infrastructure patterns
      const patterns = [
        /requireAuth/i,
        /validateInternalAuth/i,
        /FakeAuth|FakeFirestore|FakePubSub/i,
        /collection\(/,
        /subcollection/i,
        /fakeauthplugin/i,
      ];

      for (const pattern of patterns) {
        if (pattern.test(context)) {
          return { valid: true };
        }
      }

      return {
        valid: false,
        suggestion:
          'No genuine test-infra limitation found. ' +
          'test-infra requires naming a specific Fake/Mock that cannot produce the needed state.',
      };
    },
  },

  upstream: {
    description: 'Prior check makes downstream redundant',
    detect: (sourceCode, commentLine) => {
      const lines = sourceCode.split('\n');
      const lineIdx = commentLine - 1;
      const searchStart = Math.max(0, lineIdx - 50);
      const contextAbove = lines.slice(searchStart, lineIdx).join('\n');

      // Require actual early-exit patterns (if+return or if+throw) above
      const hasEarlyReturn =
        /if\s*\([^)]+\)\s*\{[^}]*\breturn\b/s.test(contextAbove) ||
        /if\s*\([^)]+\)\s*\breturn\b/.test(contextAbove);
      const hasEarlyThrow =
        /if\s*\([^)]+\)\s*\{[^}]*\bthrow\b/s.test(contextAbove) ||
        /if\s*\([^)]+\)\s*\bthrow\b/.test(contextAbove);

      if (hasEarlyReturn || hasEarlyThrow) {
        return { valid: true };
      }

      // Check for upstream-guarantee keywords in the comment explanation
      const commentContent = lines[lineIdx] ?? '';
      if (/guaranteed|ensures|always\s+(returns|succeeds|set)/i.test(commentContent)) {
        return { valid: true };
      }

      // Check for semantic upstream-guard keywords in context above
      const semanticPatterns = [
        /only\s+called/i,
        /called\s+from/i,
        /!==?\s*(null|undefined)/,
        /===?\s*(null|undefined)/,
      ];

      for (const pattern of semanticPatterns) {
        if (pattern.test(contextAbove)) {
          return { valid: true };
        }
      }

      return {
        valid: false,
        suggestion:
          'No upstream guard found. ' +
          'upstream requires an early return/throw above that makes this branch unreachable, ' +
          'or a null/undefined check in the upstream context.',
      };
    },
  },

  'module-mock': {
    description: 'SDK property getters not mockable',
    detect: (sourceCode, commentLine) => {
      const lines = sourceCode.split('\n');
      const lineIdx = commentLine - 1;

      // Known SDK clients
      const sdkPatterns = [
        'LinearClient',
        'NotionClient',
        'SentryClient',
        'Firestore',
        'Storage',
        'PubSub',
      ];

      const searchStart = Math.max(0, lineIdx - 10);
      const searchEnd = Math.min(lines.length, lineIdx + 5);

      let foundSdkClient = false;

      for (let i = searchStart; i < searchEnd; i++) {
        const line = lines[i];

        for (const pattern of sdkPatterns) {
          if (line.includes(pattern)) {
            foundSdkClient = true;
            break;
          }
        }

        // Look for property access without parentheses
        if (
          foundSdkClient &&
          /\w+\.\w+(?!\s*\()/.test(line) &&
          !/\.\.\./.test(line) // not spread operator
        ) {
          return { valid: true };
        }
      }

      return { valid: false, suggestion: 'No SDK property getter access found' };
    },
  },

  schema: {
    description: 'Schema validation makes fallback unreachable',
    detect: (sourceCode, commentLine) => {
      const lines = sourceCode.split('\n');
      const lineIdx = commentLine - 1;
      const searchStart = Math.max(0, lineIdx - 20);
      const searchEnd = Math.min(lines.length, lineIdx + 5);
      const context = lines.slice(searchStart, searchEnd).join('\n');

      const patterns = [/\.safeParse\s*\(/, /\.parse\s*\(/, /schema/i, /zod/i, /validate/i];

      for (const pattern of patterns) {
        if (pattern.test(context)) {
          return { valid: true };
        }
      }

      return { valid: false, suggestion: 'No schema validation pattern found' };
    },
  },

  'source-map': {
    description: 'Coverage tooling limitation - verified via coverage data',
    detect: null, // No static detection - verified in Phase D
    verifyCoverage: true,
  },

  'auth-guard': {
    description: 'Auth failure paths tested at middleware level',
    detect: (sourceCode, commentLine) => {
      const lines = sourceCode.split('\n');
      const lineIdx = commentLine - 1;

      // Look for auth guard patterns
      const searchStart = Math.max(0, lineIdx - 5);
      const searchEnd = Math.min(lines.length, lineIdx + 10);

      for (let i = searchStart; i < searchEnd; i++) {
        const line = lines[i];

        if (
          // isPubSubPush() call
          /isPubSubPush\s*\(/.test(line) ||
          // validateInternalAuth() call
          /validateInternalAuth\s*\(/.test(line) ||
          // 401 or 403 response
          /\.status\s*\(\s*40[13]\s*\)/.test(line) ||
          /reply\.fail\('UNAUTHORIZED'\)/.test(line) ||
          /reply\.fail\('FORBIDDEN'\)/.test(line)
        ) {
          return { valid: true };
        }
      }

      return {
        valid: false,
        suggestion: 'No auth guard pattern found (isPubSubPush, validateInternalAuth, 401/403)',
      };
    },
  },
};

// ============================================================================
// FILE WALKING
// ============================================================================

function* walkDir(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') {
      continue;
    }

    if (entry.name === '__tests__') {
      continue;
    }

    if (entry.isDirectory()) {
      yield* walkDir(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      yield fullPath;
    }
  }
}

function findFiles(directories) {
  const files = [];
  for (const dir of directories) {
    const fullDir = resolve(ROOT_DIR, dir);
    for (const file of walkDir(fullDir)) {
      files.push(file);
    }
  }
  return files;
}

// ============================================================================
// PHASE A: Find All v8 Ignore Comments
// ============================================================================

// v8-compatible format: /* v8 ignore start -- <CATEGORY>: <explanation> @preserve */
// Uses start/stop blocks so coverage is actually excluded
// @preserve ensures esbuild keeps the comment during transpilation
const V8_IGNORE_START_REGEX =
  /\/\*\s*v8\s+ignore\s+start\s+--\s+(ts-type|regex|module-init|async-timing|test-infra|upstream|module-mock|schema|source-map|auth-guard):\s*(.+?)\s*@preserve\s*\*\//;

const V8_IGNORE_STOP_REGEX = /\/\*\s*v8\s+ignore\s+stop\s+@preserve\s*\*\//;

function findV8IgnoreComments(files) {
  const comments = [];
  const malformed = [];
  const unbalanced = [];

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const lines = content.split('\n');
    const relPath = file.replace(ROOT_DIR + '/', '');

    let startCount = 0;
    let stopCount = 0;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];

      // Check for start comment with valid category
      const startMatch = V8_IGNORE_START_REGEX.exec(line);
      if (startMatch) {
        startCount++;
        comments.push({
          file: relPath,
          line: lineIdx + 1,
          category: startMatch[1],
          explanation: startMatch[2],
          type: 'start',
        });
        continue;
      }

      // Check for stop comment
      const stopMatch = V8_IGNORE_STOP_REGEX.exec(line);
      if (stopMatch) {
        stopCount++;
        comments.push({
          file: relPath,
          line: lineIdx + 1,
          type: 'stop',
        });
        continue;
      }

      // Any other v8 ignore pattern is malformed
      const v8IgnoreLooseCheck = /\/\*\s*v8\s+ignore\s+/.exec(line);
      if (v8IgnoreLooseCheck) {
        const fullMatch = /\/\*\s*v8\s+ignore\s+[^\*]*?\*\//.exec(line);
        const foundContent = fullMatch ? fullMatch[0] : line.trim();

        malformed.push({
          file: relPath,
          line: lineIdx + 1,
          content: foundContent,
          message: `Invalid format. Required: /* v8 ignore start -- <CATEGORY>: <reason> @preserve */ ... /* v8 ignore stop @preserve */`,
        });
      }
    }

    // Check balanced pairs per file
    if (startCount !== stopCount) {
      unbalanced.push({
        file: relPath,
        startCount,
        stopCount,
        message: `Unbalanced v8 ignore blocks: ${startCount} start(s), ${stopCount} stop(s)`,
      });
    }
  }

  return { comments, malformed, unbalanced };
}

// ============================================================================
// PHASE B: Syntax Validation
// ============================================================================

function validateSyntax(comments) {
  const errors = [];
  const validComments = new Set();

  for (const comment of comments) {
    // Skip stop comments - they don't need validation
    if (comment.type === 'stop') {
      continue;
    }

    // Category validation already done by strict regex in findV8IgnoreComments
    // Just need to verify explanation exists
    if (!comment.explanation || comment.explanation.trim() === '') {
      errors.push({
        file: comment.file,
        line: comment.line,
        message: 'Missing explanation after "--"',
      });
      continue;
    }

    validComments.add(comment);
  }

  return { errors, validComments };
}

// ============================================================================
// PHASE C: Pattern Validation
// ============================================================================

function validatePatterns(comments, overriddenFiles, taskMap) {
  const errors = [];
  const overrideSkips = [];

  for (const comment of comments) {
    const detector = CATEGORY_DETECTORS[comment.category];

    // source-map has no static detection
    if (!detector || detector.detect === null) {
      continue;
    }

    const filePath = resolve(ROOT_DIR, comment.file);
    const sourceCode = readFileSync(filePath, 'utf8');

    const result = detector.detect(sourceCode, comment.line, comment.file);

    if (!result.valid) {
      if (checkOverride(comment, overriddenFiles, taskMap, overrideSkips)) continue;

      errors.push({
        file: comment.file,
        line: comment.line,
        message: `Pattern validation failed for category "${comment.category}": ${result.suggestion}`,
      });
    }
  }

  return { errors, overrideSkips };
}

// ============================================================================
// Override helper (shared by Phase C and C-1)
// ============================================================================

function checkOverride(comment, overriddenFiles, taskMap, overrideSkips) {
  if (overriddenFiles.has(comment.file)) {
    const taskId = taskMap.get(comment.file) ?? 'UNKNOWN';
    overrideSkips.push({ file: comment.file, line: comment.line, taskId });
    return true;
  }
  return false;
}

// ============================================================================
// PHASE C-1: NEVER-valid Pattern Blocklist
// ============================================================================

// Intentionally conservative patterns — catches the most common !result.ok form.
// Does NOT match `result.ok === false`, compound checks, or destructured patterns
// to avoid false positives. Broadening requires auditing all existing v8 ignores.
const NEVER_VALID_PATTERNS = [
  {
    pattern: /\bcatch\s*\(/,
    message: 'Catch blocks are always testable — throw in test via mock dependency',
  },
  {
    pattern: /if\s*\(\s*![\w.]+\.ok\b/,
    message: 'Result error paths are always testable — mock dependency to return err()',
  },
  {
    pattern: /if\s*\(\s*[\w.]+\s*===?\s*['"]failed['"]/,
    message: 'Status checks are always testable — pass matching input in test',
  },
  {
    pattern: /if\s*\(\s*[\w.]+\s*===?\s*['"]interrupted['"]/,
    message: 'Status checks are always testable — pass matching input in test',
  },
];

// Categories that legitimately cover NEVER-valid patterns
const NEVER_VALID_EXEMPT_CATEGORIES = ['auth-guard', 'module-init'];

function validateNeverValidPatterns(comments, overriddenFiles, taskMap) {
  const errors = [];
  const overrideSkips = [];

  for (const comment of comments) {
    if (NEVER_VALID_EXEMPT_CATEGORIES.includes(comment.category)) continue;

    const filePath = resolve(ROOT_DIR, comment.file);
    const sourceCode = readFileSync(filePath, 'utf8');
    const lines = sourceCode.split('\n');
    const commentLineIdx = comment.line - 1;

    // Find the matching stop to get the ignored code block
    const stopLineIdx = lines.findIndex(
      (l, i) => i > commentLineIdx && V8_IGNORE_STOP_REGEX.test(l)
    );
    if (stopLineIdx === -1) continue;

    const ignoredBlock = lines.slice(commentLineIdx + 1, stopLineIdx).join('\n');

    for (const { pattern, message } of NEVER_VALID_PATTERNS) {
      if (pattern.test(ignoredBlock)) {
        if (checkOverride(comment, overriddenFiles, taskMap, overrideSkips)) break;

        errors.push({
          file: comment.file,
          line: comment.line,
          message: `NEVER-valid pattern in ignored code: ${message}`,
        });
        break; // One NEVER-valid match is enough to fail
      }
    }
  }

  return { errors, overrideSkips };
}

// ============================================================================
// PHASE D: Coverage Cross-Reference
// ============================================================================

function validateCoverage(comments, coverageData) {
  const errors = [];
  const sourceMapComments = comments.filter((c) => c.category === 'source-map');

  // For source-map comments, verify they're actually needed
  for (const comment of sourceMapComments) {
    const fileCoverage = coverageData[comment.file];

    if (!fileCoverage) {
      // File not in coverage, skip validation
      continue;
    }

    // Check if the line/branch is covered
    const branchData = fileCoverage.b;

    if (branchData) {
      // v8 coverage uses branch ranges: [startLine, startCol, endLine, endCol]
      // We need to find branches near our comment line
      for (const [branchId, range] of Object.entries(branchData)) {
        const startLine = range[0];

        // If branch is at or near the comment line
        if (Math.abs(startLine - (comment.line - 1)) <= 2) {
          // Check if covered (count > 0)
          if (range[4] > 0) {
            // Branch is covered, so source-map comment might be obsolete
            // But we allow it since the comment says "covered but v8 doesn't detect"
            // This is actually the expected state for source-map comments
          }
        }
      }
    }
  }

  return errors;
}

// ============================================================================
// PHASE E: Report Missing Comments
// ============================================================================

function reportMissingComments(coverageData, comments) {
  const missing = [];

  // Normalize file path from coverage data to match comment paths (relative)
  function normalizePath(filePath) {
    return filePath.replace(ROOT_DIR + '/', '');
  }

  // Build map of v8 ignore ranges per file (start line -> stop line)
  // A branch is exempt if it falls BETWEEN a start and its matching stop
  const ignoreRangesMap = new Map();

  for (const comment of comments) {
    if (comment.type !== 'start') continue;

    const fileKey = comment.file;
    if (!ignoreRangesMap.has(fileKey)) {
      ignoreRangesMap.set(fileKey, []);
    }

    // Find the matching stop for this start
    const matchingStop = comments.find(
      (c) => c.file === comment.file && c.type === 'stop' && c.line > comment.line
    );

    if (matchingStop) {
      ignoreRangesMap.get(fileKey).push({
        start: comment.line,
        stop: matchingStop.line,
      });
    }
  }

  // Find uncovered branches without exemptions
  for (const [filePath, fileData] of Object.entries(coverageData)) {
    if (filePath.includes('__tests__')) continue;

    const branches = fileData.b;
    const branchMap = fileData.branchMap;

    if (!branches || !branchMap) continue;

    const normalizedPath = normalizePath(filePath);
    const ranges = ignoreRangesMap.get(normalizedPath) ?? [];

    for (const [branchId, hitCounts] of Object.entries(branches)) {
      const branchInfo = branchMap[branchId];
      if (!branchInfo) continue;

      for (let i = 0; i < hitCounts.length; i++) {
        if (hitCounts[i] === 0) {
          const location = branchInfo.locations?.[i];
          const branchLine = location?.start?.line ?? branchInfo.line;

          if (branchLine) {
            // Check if branch line falls within any v8 ignore start/stop range
            const isWithinRange = ranges.some(
              (range) => branchLine >= range.start && branchLine <= range.stop
            );

            if (!isWithinRange) {
              missing.push({ file: normalizedPath, line: branchLine });
            }
          }
        }
      }
    }
  }

  return missing;
}

// ============================================================================
// PHASE E-1: Report Exempted Branches (for visibility)
// ============================================================================

function reportExemptedBranches(coverageData, comments) {
  const exempted = [];

  function normalizePath(filePath) {
    return filePath.replace(ROOT_DIR + '/', '');
  }

  // Build map of v8 ignore ranges
  const ignoreRangesMap = new Map();
  for (const comment of comments) {
    if (comment.type !== 'start') continue;
    const fileKey = comment.file;
    if (!ignoreRangesMap.has(fileKey)) ignoreRangesMap.set(fileKey, []);
    const matchingStop = comments.find(
      (c) => c.file === comment.file && c.type === 'stop' && c.line > comment.line
    );
    if (matchingStop) {
      ignoreRangesMap.get(fileKey).push({
        start: comment.line,
        stop: matchingStop.line,
        category: comment.category,
      });
    }
  }

  // Find branches with null hits (exempted by v8 ignore)
  for (const [filePath, fileData] of Object.entries(coverageData)) {
    if (filePath.includes('__tests__')) continue;
    const branches = fileData.b;
    const branchMap = fileData.branchMap;
    if (!branches || !branchMap) continue;

    const normalizedPath = normalizePath(filePath);
    const ranges = ignoreRangesMap.get(normalizedPath) ?? [];

    for (const [branchId, hitCounts] of Object.entries(branches)) {
      if (!Array.isArray(hitCounts)) continue;
      const branchInfo = branchMap[branchId];
      if (!branchInfo) continue;

      // Get the full span of this branch (from start to end line)
      const branchStartLine = branchInfo.loc?.start?.line ?? branchInfo.line;
      const branchEndLine = branchInfo.loc?.end?.line ?? branchStartLine;

      for (let i = 0; i < hitCounts.length; i++) {
        if (hitCounts[i] === null) {
          // Check if ANY part of this branch's span overlaps with v8 ignore range
          const coveringRange = ranges.find(
            (range) => !(branchEndLine < range.start || branchStartLine > range.stop)
          );

          if (coveringRange) {
            exempted.push({
              file: normalizedPath,
              line: branchStartLine,
              endLine: branchEndLine,
              category: coveringRange.category,
            });
          }
        }
      }
    }
  }

  return exempted;
}

// ============================================================================
// PHASE F: Verify 1:1 Mapping (each block covers exactly 1 branch)
// ============================================================================

function verifyOneToOneMapping(coverageData, comments) {
  const issues = [];

  function normalizePath(filePath) {
    return filePath.replace(ROOT_DIR + '/', '');
  }

  // Build map of v8 ignore ranges per file with their line info
  const ignoreRangesMap = new Map();

  for (const comment of comments) {
    if (comment.type !== 'start') continue;

    const fileKey = comment.file;
    if (!ignoreRangesMap.has(fileKey)) {
      ignoreRangesMap.set(fileKey, []);
    }

    const matchingStop = comments.find(
      (c) => c.file === comment.file && c.type === 'stop' && c.line > comment.line
    );

    if (matchingStop) {
      ignoreRangesMap.get(fileKey).push({
        start: comment.line,
        stop: matchingStop.line,
        branchesInRange: [],
      });
    }
  }

  // Count uncovered branches per range
  let totalUncoveredBranches = 0;
  let totalExemptedBranches = 0;

  for (const [filePath, fileData] of Object.entries(coverageData)) {
    if (filePath.includes('__tests__')) continue;

    const branches = fileData.b;
    const branchMap = fileData.branchMap;

    if (!branches || !branchMap) continue;

    const normalizedPath = normalizePath(filePath);
    const ranges = ignoreRangesMap.get(normalizedPath) ?? [];

    for (const [branchId, hitCounts] of Object.entries(branches)) {
      const branchInfo = branchMap[branchId];
      if (!branchInfo) continue;

      for (let i = 0; i < hitCounts.length; i++) {
        if (hitCounts[i] === 0) {
          totalUncoveredBranches++;
          const location = branchInfo.locations?.[i];
          const branchLine = location?.start?.line ?? branchInfo.line;

          if (branchLine) {
            for (const range of ranges) {
              if (branchLine >= range.start && branchLine <= range.stop) {
                range.branchesInRange.push(branchLine);
                totalExemptedBranches++;
              }
            }
          }
        }
      }
    }
  }

  // Find ranges with multiple branches
  for (const [file, ranges] of ignoreRangesMap.entries()) {
    for (const range of ranges) {
      if (range.branchesInRange.length > 1) {
        issues.push({
          file,
          start: range.start,
          stop: range.stop,
          count: range.branchesInRange.length,
          lines: range.branchesInRange,
        });
      }
    }
  }

  // Count total v8 ignore blocks
  const totalBlocks = comments.filter((c) => c.type === 'start').length;

  return {
    issues,
    stats: {
      totalBlocks,
      totalUncoveredBranches,
      totalExemptedBranches,
    },
  };
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  // Check for --help flag
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('v8 Ignore Comment Validator');
    console.log('');
    console.log('Validates v8 ignore start/stop blocks in the codebase.');
    console.log('');
    console.log('Required format:');
    console.log('  /* v8 ignore start -- <CATEGORY>: <reason> @preserve */');
    console.log('  ...excluded code...');
    console.log('  /* v8 ignore stop @preserve */');
    console.log('');
    console.log('Usage: node scripts/verify-v8-ignore.mjs');
    console.log('');
    console.log('Valid categories:');
    VALID_CATEGORIES.forEach((cat) => console.log(`  - ${cat}`));
    console.log('');
    console.log('Flags:');
    console.log('  --no-overrides  Ignore v8-ignore-overrides.json (strict auditing)');
    console.log('  --all           Show all uncovered branches (not just first 50)');
    console.log('');
    console.log('Rules:');
    console.log('  - Every start must have a matching stop in the same file');
    console.log('  - Category must match the code context (validated by detectors)');
    process.exit(0);
  }

  // Find all TypeScript files in apps/, packages/, workers/
  const files = findFiles(['apps', 'packages', 'workers']);

  // Phase A: Find all v8 ignore comments
  const { comments, malformed: malformedComments, unbalanced } = findV8IgnoreComments(files);

  // Phase A.5: Report malformed comments and unbalanced blocks
  const hasMalformed = malformedComments.length > 0;
  const hasUnbalanced = unbalanced.length > 0;

  if (hasMalformed || hasUnbalanced) {
    if (hasMalformed) {
      console.log(`\n❌ ${malformedComments.length} malformed v8 ignore comment(s):\n`);
      malformedComments.forEach((m) => {
        console.log(`  ${m.file}:${m.line}: ${m.message}`);
        console.log(`    Found: ${m.content}`);
      });
    }
    if (hasUnbalanced) {
      console.log(`\n❌ ${unbalanced.length} file(s) with unbalanced start/stop:\n`);
      unbalanced.forEach((u) => {
        console.log(`  ${u.file}: ${u.message}`);
      });
    }
    process.exit(1);
  }

  // Phase B: Syntax validation
  const { errors: syntaxErrors, validComments } = validateSyntax(comments);

  // Phase B-1: Blocker keyword enforcement
  const { errors: blockerErrors } = validateBlockerKeywords(Array.from(validComments));

  // Load overrides
  const { overriddenFiles, taskMap } = loadOverrides();

  // Phase C: Pattern validation
  const { errors: patternErrors, overrideSkips: patternOverrideSkips } = validatePatterns(
    Array.from(validComments),
    overriddenFiles,
    taskMap
  );

  // Phase C-1: NEVER-valid pattern blocklist
  const { errors: neverValidErrors, overrideSkips: neverValidOverrideSkips } =
    validateNeverValidPatterns(Array.from(validComments), overriddenFiles, taskMap);

  // Phase D: Coverage cross-reference
  const coveragePath = resolve(ROOT_DIR, 'coverage/coverage-final.json');
  let coverageErrors = [];

  if (existsSync(coveragePath)) {
    const coverageData = JSON.parse(readFileSync(coveragePath, 'utf8'));
    coverageErrors = validateCoverage(Array.from(validComments), coverageData);
  }

  // Phase E: Report missing comments
  let missingReport = [];

  if (existsSync(coveragePath)) {
    const coverageData = JSON.parse(readFileSync(coveragePath, 'utf8'));
    missingReport = reportMissingComments(coverageData, comments);
  }

  // Phase E-1: Report exempted branches (for visibility)
  let exemptedReport = [];

  if (existsSync(coveragePath)) {
    const coverageData = JSON.parse(readFileSync(coveragePath, 'utf8'));
    exemptedReport = reportExemptedBranches(coverageData, comments);
  }

  // Phase F: Verify 1:1 mapping (each block covers exactly 1 branch)
  let mappingResult = {
    issues: [],
    stats: { totalBlocks: 0, totalUncoveredBranches: 0, totalExemptedBranches: 0 },
  };

  if (existsSync(coveragePath)) {
    const coverageData = JSON.parse(readFileSync(coveragePath, 'utf8'));
    mappingResult = verifyOneToOneMapping(coverageData, comments);
  }

  // Output
  const allErrors = [
    ...syntaxErrors,
    ...blockerErrors,
    ...patternErrors,
    ...neverValidErrors,
    ...coverageErrors,
  ];
  const validCount = validComments.size;

  // Count lines within v8 ignore blocks
  const startComments = comments.filter((c) => c.type === 'start');
  const blockCount = startComments.length;

  // Report override skips
  const allOverrideSkips = [...patternOverrideSkips, ...neverValidOverrideSkips];
  if (allOverrideSkips.length > 0) {
    console.log(`\n⏭ ${allOverrideSkips.length} block(s) skipped via overrides:`);
    for (const skip of allOverrideSkips) {
      console.log(`  ⏭ OVERRIDE: ${skip.file}:${skip.line} (${skip.taskId})`);
    }
  }

  console.log(`\n✓ ${validCount} v8 ignore comments validated`);
  console.log(
    `  ${blockCount} exclusion blocks (lines within blocks are not tracked by v8 coverage)`
  );

  if (allErrors.length > 0) {
    console.log(`\n❌ ${allErrors.length} error(s) found:\n`);
    allErrors.forEach((e) => {
      console.log(`  ${e.file}:${e.line}: ${e.message}`);
    });
  }

  if (missingReport.length > 0) {
    const uniqueMissing = [
      ...new Map(missingReport.map((m) => [`${m.file}:${m.line}`, m])).values(),
    ];
    const showAll = process.argv.includes('--all');
    const limit = showAll ? uniqueMissing.length : 50;

    console.log(`\n❌ ${uniqueMissing.length} uncovered branch(es) without exemption:\n`);
    uniqueMissing.slice(0, limit).forEach((m) => {
      console.log(`  ${m.file}:${m.line}`);
    });
    if (uniqueMissing.length > limit) {
      console.log(`  ... and ${uniqueMissing.length - limit} more (use --all to see all)`);
    }
    console.log(
      `\nAdd /* v8 ignore start -- <CATEGORY>: reason @preserve */ ... /* v8 ignore stop @preserve */ or write tests.`
    );
    console.log(
      `Valid categories: ts-type, regex, module-init, async-timing, test-infra, upstream, module-mock, schema, source-map, auth-guard`
    );
  }

  // CRITICAL: Fail on exempted branches (v8 ignore on branches is not allowed)
  if (exemptedReport.length > 0) {
    // Group by category for clearer output
    const byCategory = new Map();
    for (const e of exemptedReport) {
      if (!byCategory.has(e.category)) byCategory.set(e.category, []);
      byCategory.get(e.category).push(e);
    }

    console.log(
      `\n❌ ${exemptedReport.length} exempted branch(es) found - v8 ignore on branches is NOT ALLOWED:\n`
    );

    for (const [category, branches] of byCategory.entries()) {
      console.log(`  [${category}]`);
      const uniqueFiles = [
        ...new Set(branches.map((b) => `${b.file}:${b.line}-${b.endLine ?? b.line}`)),
      ];
      uniqueFiles.slice(0, 10).forEach((loc) => {
        console.log(`    ${loc}`);
      });
      if (uniqueFiles.length > 10) {
        console.log(`    ... and ${uniqueFiles.length - 10} more`);
      }
      console.log('');
    }
    console.log(
      'CRITICAL: v8 ignore on branches is NOT ALLOWED.\n' +
        '\n' +
        'Branch exemption with v8 ignore hides untested code paths from CI.\n' +
        'All branches must be covered by tests.\n' +
        '\n' +
        'To fix: Remove the v8 ignore comment and write a test for this code path.'
    );
  }

  const hasErrors = allErrors.length > 0;
  const hasMissing = missingReport.length > 0;
  const hasExempted = exemptedReport.length > 0;
  process.exit(hasErrors || hasMissing || hasExempted ? 1 : 0);
}

async function selfTest() {
  console.log('Running self-tests for validateBlockerKeywords...');

  // Test: universal keyword match
  const result1 = validateBlockerKeywords([
    {
      type: 'start',
      category: 'ts-type',
      explanation: 'TypeScript cannot narrow this type',
      file: 'test.ts',
      line: 1,
    },
  ]);
  assert.equal(result1.errors.length, 0, 'universal keyword "cannot" should pass');

  // Test: category-specific keyword accepted
  const result2 = validateBlockerKeywords([
    {
      type: 'start',
      category: 'ts-type',
      explanation: 'type narrowing for overloaded signature',
      file: 'test.ts',
      line: 1,
    },
  ]);
  assert.equal(result2.errors.length, 0, 'ts-type keyword "type narrowing" should pass');

  // Test: rejection when no keyword present
  const result3 = validateBlockerKeywords([
    {
      type: 'start',
      category: 'ts-type',
      explanation: 'some random description',
      file: 'test.ts',
      line: 1,
    },
  ]);
  assert.equal(result3.errors.length, 1, 'no blocker keyword should fail');

  // Test: stop comments skipped
  const result4 = validateBlockerKeywords([{ type: 'stop', file: 'test.ts', line: 2 }]);
  assert.equal(result4.errors.length, 0, 'stop comments should be skipped');

  // Test: universal keyword works across categories
  const result5 = validateBlockerKeywords([
    {
      type: 'start',
      category: 'upstream',
      explanation: 'type narrowing makes branch dead',
      file: 'test.ts',
      line: 1,
    },
  ]);
  assert.equal(result5.errors.length, 0, '"narrowing" is a universal keyword');

  // Test: category-specific keyword rejected for wrong category
  const result6 = validateBlockerKeywords([
    {
      type: 'start',
      category: 'upstream',
      explanation: 'capture group in the regex',
      file: 'test.ts',
      line: 1,
    },
  ]);
  assert.equal(
    result6.errors.length,
    1,
    '"capture group" is regex-specific, should fail for upstream'
  );

  console.log('All self-tests passed ✅');
}

// Wire into CLI
if (process.argv.includes('--self-test')) {
  selfTest().then(() => process.exit(0));
} else {
  main();
}
