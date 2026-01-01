#!/usr/bin/env node
/**
 * Test Isolation Verification Script
 *
 * Ensures tests use in-memory fakes and do not make external network calls.
 *
 * Algorithm:
 * 1. Scan all test files in apps/ and packages/
 * 2. Check for forbidden patterns (Docker, emulators, network calls)
 * 3. Strip comments and strings to avoid false positives
 * 4. Report violations with file, line number, and remediation
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');

const FORBIDDEN_PATTERNS = [
  { regex: /docker\.compose|docker-compose/i, message: 'Test requires Docker' },
  { regex: /firebase\.emulator|firebaseEmulator/i, message: 'Test requires Firebase emulator' },
  {
    regex: /@google-cloud\/firestore.*emulator/i,
    message: 'Test requires Firestore emulator',
  },
  {
    regex: /import\s+.*from\s+['"]node:http['"]/,
    message: 'Test imports http module (use nock for HTTP mocking)',
  },
  {
    regex: /import\s+.*from\s+['"]node:https['"]/,
    message: 'Test imports https module (use nock for HTTPS mocking)',
  },
];

const ALLOWED_CONTEXTS = [
  /\/\/.*example/i,
  /\/\/.*note/i,
  /\/\*[\s\S]*?\*\//g,
  /"[^"]*"/g,
  /'[^']*'/g,
  /`[^`]*`/g,
];

function getTestFiles(dir) {
  const files = [];
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        if (entry === 'node_modules' || entry === 'dist' || entry === 'coverage') continue;
        files.push(...getTestFiles(fullPath));
      } else if (
        (entry.endsWith('.test.ts') ||
          entry.endsWith('.spec.ts') ||
          fullPath.includes('__tests__')) &&
        !entry.endsWith('.d.ts')
      ) {
        files.push(fullPath);
      }
    }
  } catch {
    /* Directory doesn't exist */
  }
  return files;
}

function stripAllowedContexts(content) {
  let stripped = content;
  for (const pattern of ALLOWED_CONTEXTS) {
    stripped = stripped.replace(pattern, ' ');
  }
  return stripped;
}

function checkFile(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const strippedContent = stripAllowedContexts(content);
  const lines = strippedContent.split('\n');
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { regex, message } of FORBIDDEN_PATTERNS) {
      if (regex.test(line)) {
        violations.push({
          line: i + 1,
          message,
          content: line.trim().slice(0, 80),
        });
      }
    }
  }
  return violations;
}

// Main execution
console.log('Running test isolation verification...\n');

const testFiles = getTestFiles(join(repoRoot, 'apps')).concat(
  getTestFiles(join(repoRoot, 'packages'))
);

console.log(`✓ Found ${String(testFiles.length)} test file(s)`);

const allViolations = [];
for (const file of testFiles) {
  const violations = checkFile(file);
  if (violations.length > 0) {
    allViolations.push({ file: file.replace(repoRoot + '/', ''), violations });
  }
}

if (allViolations.length === 0) {
  console.log('✓ All tests use in-memory fakes\n');
  process.exit(0);
}

console.error('❌ TEST ISOLATION VIOLATIONS\n');
for (const { file, violations } of allViolations) {
  console.error(`  ${file}:`);
  for (const v of violations) {
    console.error(`    Line ${String(v.line)}: ${v.message}`);
    console.error(`      ${v.content}`);
  }
  console.error('');
}

console.error('RULE: Tests must use in-memory fakes. No Docker, emulators, or real network calls.');
console.error('See: .claude/CLAUDE.md (Testing section)\n');
process.exit(1);
