#!/usr/bin/env node

/**
 * Verifies that test output contains only vitest-expected lines.
 * Detects stdout pollution from non-silent loggers, console.log, etc.
 *
 * Reads captured test output from scripts/test-results/test-output.txt
 * (written by ci.mjs via the saveTo config on test:coverage).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OUTPUT_FILE = resolve(import.meta.dirname, 'test-results/test-output.txt');

function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

const VITEST_PATTERNS = [
  /^\s*$/,
  /^>/,
  /^\s*(RUN|PASS|FAIL)\b/,
  /Coverage enabled with/,
  /^\s*[✓✗×↓]/,
  /^\s*(Test Files|Tests|Start at|Duration)\s/,
  /^\s*%\s/,
  /^-+\|/,
  /^\s*File\s+\|/,
  /^All files\s/,
  /\|\s+[\d.]+\s+\|/,
  /^@@PHASE_TIMING@@/,
  /^\(node:\d+\) \[DEP\d+\] DeprecationWarning:/,
  /^\(Use `node --trace-deprecation \.\.\.` to show where the warning was created\)$/,
];

function isVitestLine(line) {
  return VITEST_PATTERNS.some((pattern) => pattern.test(line));
}

function findNearestTestFile(lines, index) {
  const testFilePattern = /^\s*[✓✗×↓]\s+(\S+\.test\.ts)/;
  for (let i = index - 1; i >= 0; i--) {
    const match = lines[i].match(testFilePattern);
    if (match) return match[1];
  }
  return 'unknown';
}

function main() {
  let raw;
  try {
    raw = readFileSync(OUTPUT_FILE, 'utf-8');
  } catch {
    console.error(`❌ Test output file not found: ${OUTPUT_FILE}`);
    console.error('   Ensure test:coverage runs before this check (saveTo in ci.mjs).');
    process.exit(1);
  }

  const lines = stripAnsi(raw).split('\n');
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!isVitestLine(line)) {
      violations.push({
        lineNumber: i + 1,
        content: line,
        source: findNearestTestFile(lines, i),
      });
    }
  }

  if (violations.length === 0) {
    console.log('✅ No unexpected test stdout output detected');
    process.exit(0);
  }

  const bySource = new Map();
  for (const v of violations) {
    const existing = bySource.get(v.source) ?? [];
    existing.push(v);
    bySource.set(v.source, existing);
  }

  console.error(`❌ Found ${violations.length} unexpected stdout line(s) in test output:\n`);

  for (const [source, entries] of bySource) {
    console.error(`  From: ${source}`);
    const shown = entries.slice(0, 3);
    for (const entry of shown) {
      const preview =
        entry.content.length > 120 ? entry.content.slice(0, 117) + '...' : entry.content;
      console.error(`    L${entry.lineNumber}: ${preview}`);
    }
    if (entries.length > 3) {
      console.error(`    ... and ${entries.length - 3} more line(s)`);
    }
    console.error('');
  }

  console.error(
    "💡 Fix: Use pino({ level: 'silent' }) in test loggers, or remove console.log from test code."
  );
  console.error(`   Full output: ${OUTPUT_FILE}\n`);
  process.exit(1);
}

main();
