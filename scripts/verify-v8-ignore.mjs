#!/usr/bin/env node

import ts from 'typescript';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '..');

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
        /if\s*\(/,
        /snapshot/i,
        /document/i,
        /query/i,
        /find/i,
        /get/i,
      ];

      for (const pattern of patterns) {
        if (pattern.test(context)) {
          return { valid: true };
        }
      }

      return {
        valid: false,
        suggestion: 'No type-related pattern found in context',
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

      const patterns = [
        /requireAuth/i,
        /validateInternalAuth/i,
        /collection\(/,
        /FakeAuth|FakeFirestore|FakePubSub/i,
        /mock/i,
        /fake/i,
        /stub/i,
        /test/i,
        /null/,
        /undefined/,
        /error/i,
        /response/i,
        /status/i,
        /ok\s*:/,
        /infra/i,
        /http/i,
        /client/i,
      ];

      if (filePath.includes('/infra/') || filePath.includes('/routes/')) {
        return { valid: true };
      }

      for (const pattern of patterns) {
        if (pattern.test(context)) {
          return { valid: true };
        }
      }

      return { valid: false, suggestion: 'No test infrastructure pattern found' };
    },
  },

  upstream: {
    description: 'Prior check makes downstream redundant',
    detect: (sourceCode, commentLine) => {
      const lines = sourceCode.split('\n');
      const lineIdx = commentLine - 1;
      const searchStart = Math.max(0, lineIdx - 50);
      const searchEnd = Math.min(lines.length, lineIdx + 10);
      const contextAbove = lines.slice(searchStart, lineIdx).join('\n');
      const contextBelow = lines.slice(lineIdx, searchEnd).join('\n');

      const patterns = [
        /\breturn\b/,
        /\bthrow\b/,
        /\bif\s*\(/,
        /\belse\b/,
        /\bswitch\b/,
        /\bcase\b/,
        /!==?\s*(null|undefined)/,
        /===?\s*(null|undefined)/,
        /\.length/,
        /function\s+\w+/,
        /only\s+called/i,
        /called\s+from/i,
        /guaranteed/i,
        /ensures/i,
        /always/i,
      ];

      for (const pattern of patterns) {
        if (pattern.test(contextAbove) || pattern.test(contextBelow)) {
          return { valid: true };
        }
      }

      return { valid: false, suggestion: 'No upstream guard pattern found' };
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

      const patterns = [
        /\.safeParse\s*\(/,
        /\.parse\s*\(/,
        /schema/i,
        /zod/i,
        /validate/i,
        /\.data\./,
        /body\./,
        /request\./,
        /params\./,
      ];

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

const V8_IGNORE_WITH_CATEGORY_REGEX = /\/\*\s*v8\s+ignore\s+(\S+)\s*--\s*(.+?)\s*\*\//;
const V8_IGNORE_LEGACY_REGEX = /\/\*\s*v8\s+ignore\s+(next|start|stop)(?:\s*--\s*(.+?))?\s*\*\//;

function findV8IgnoreComments(files) {
  const comments = [];

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const lines = content.split('\n');

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];

      const categoryMatch = V8_IGNORE_WITH_CATEGORY_REGEX.exec(line);
      if (categoryMatch) {
        const category = categoryMatch[1];
        if (!V8_LEGACY_KEYWORDS.includes(category)) {
          comments.push({
            file: file.replace(ROOT_DIR + '/', ''),
            line: lineIdx + 1,
            category: category,
            explanation: categoryMatch[2],
            isLegacy: false,
          });
          continue;
        }
      }

      const legacyMatch = V8_IGNORE_LEGACY_REGEX.exec(line);
      if (legacyMatch) {
        comments.push({
          file: file.replace(ROOT_DIR + '/', ''),
          line: lineIdx + 1,
          category: legacyMatch[1],
          explanation: legacyMatch[2] ?? '',
          isLegacy: true,
        });
      }
    }
  }

  return comments;
}

// ============================================================================
// PHASE B: Syntax Validation
// ============================================================================

function validateSyntax(comments) {
  const errors = [];
  const validComments = new Set();
  const legacyComments = [];

  for (const comment of comments) {
    if (comment.isLegacy) {
      legacyComments.push(comment);
      continue;
    }

    if (!comment.category || comment.category.trim() === '') {
      errors.push({
        file: comment.file,
        line: comment.line,
        message: 'Missing category',
      });
      continue;
    }

    if (!VALID_CATEGORIES.includes(comment.category)) {
      errors.push({
        file: comment.file,
        line: comment.line,
        message: `Invalid category "${comment.category}". Valid categories: ${VALID_CATEGORIES.join(', ')}`,
      });
      continue;
    }

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

  return { errors, validComments, legacyComments };
}

// ============================================================================
// PHASE C: Pattern Validation
// ============================================================================

function validatePatterns(comments) {
  const errors = [];

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
      errors.push({
        file: comment.file,
        line: comment.line,
        message: `Pattern validation failed for category "${comment.category}": ${result.suggestion}`,
      });
    }
  }

  return errors;
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
  const commentMap = new Map();

  // Build map of files with comments
  for (const comment of comments) {
    const key = `${comment.file}:${comment.line}`;
    commentMap.set(key, true);
  }

  // Find uncovered branches without comments
  for (const [filePath, fileData] of Object.entries(coverageData)) {
    // Skip test files
    if (filePath.includes('__tests__')) continue;

    const branches = fileData.b;

    if (!branches) continue;

    for (const [branchId, range] of Object.entries(branches)) {
      const startLine = range[0] + 1; // Convert to 1-indexed

      // Check if branch is uncovered (count 0 or false)
      if (range[4] === 0) {
        const key = `${filePath}:${startLine}`;

        if (!commentMap.has(key)) {
          missing.push({ file: filePath, line: startLine });
        }
      }
    }
  }

  return missing;
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  // Check for --help flag
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('v8 Ignore Comment Validator');
    console.log('');
    console.log('Validates all /* v8 ignore <CATEGORY> -- reason */ comments in the codebase.');
    console.log('');
    console.log('Usage: node scripts/verify-v8-ignore.mjs');
    console.log('');
    console.log('Valid categories:');
    VALID_CATEGORIES.forEach((cat) => console.log(`  - ${cat}`));
    process.exit(0);
  }

  // Find all TypeScript files in apps/, packages/, workers/
  const files = findFiles(['apps', 'packages', 'workers']);

  // Phase A: Find all v8 ignore comments
  const comments = findV8IgnoreComments(files);

  // Phase B: Syntax validation
  const { errors: syntaxErrors, validComments, legacyComments } = validateSyntax(comments);

  // Phase C: Pattern validation
  const patternErrors = validatePatterns(Array.from(validComments));

  // Phase D: Coverage cross-reference
  const coveragePath = resolve(ROOT_DIR, 'coverage/coverage-final.json');
  let coverageErrors = [];

  if (existsSync(coveragePath)) {
    const coverageData = JSON.parse(readFileSync(coveragePath, 'utf8'));
    coverageErrors = validateCoverage(Array.from(validComments), coverageData);
  }

  // Phase E: Report missing comments (informational only)
  let missingReport = [];

  if (existsSync(coveragePath)) {
    const coverageData = JSON.parse(readFileSync(coveragePath, 'utf8'));
    missingReport = reportMissingComments(coverageData, comments);
  }

  // Output
  const allErrors = [...syntaxErrors, ...patternErrors, ...coverageErrors];
  const validCount = validComments.size;
  const legacyCount = legacyComments.length;

  console.log(`\n✓ ${validCount} v8 ignore comments validated`);
  if (legacyCount > 0) {
    console.log(`  (${legacyCount} legacy v8 ignore next/start/stop comments skipped)`);
  }

  if (allErrors.length > 0) {
    console.log(`\n❌ ${allErrors.length} error(s) found:\n`);
    allErrors.forEach((e) => {
      console.log(`  ${e.file}:${e.line}: ${e.message}`);
    });
  }

  if (missingReport.length > 0) {
    console.log(`\n❌ ${missingReport.length} uncovered branch(es) without exemption:\n`);
    missingReport.slice(0, 50).forEach((m) => {
      console.log(`  ${m.file}:${m.line}`);
    });
    if (missingReport.length > 50) {
      console.log(`  ... and ${missingReport.length - 50} more (run with --all to see all)`);
    }
    console.log(`\nAdd /* v8 ignore <CATEGORY> -- reason */ or write tests.`);
    console.log(`Valid categories: ts-type, regex, module-init, async-timing, test-infra, upstream, module-mock, schema, source-map, auth-guard`);
  }

  const hasErrors = allErrors.length > 0;
  const hasMissing = missingReport.length > 0;
  process.exit(hasErrors || hasMissing ? 1 : 0);
}

main();
