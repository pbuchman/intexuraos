#!/usr/bin/env node
/**
 * Vitest Config Protection Verification
 *
 * Ensures coverage thresholds remain at 95% and exclusion count doesn't grow.
 *
 * Algorithm:
 * 1. Parse vitest.config.ts
 * 2. Extract coverage thresholds (lines, branches, functions, statements)
 * 3. Count exclusion array items
 * 4. Verify all thresholds ≥ 95 and exclusion count ≤ baseline
 * 5. Report violations with clear error messages
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const configPath = join(repoRoot, 'vitest.config.ts');

const REQUIRED_THRESHOLDS = { lines: 95, branches: 95, functions: 95, statements: 95 };
const MAX_EXCLUSIONS = 19; // Current baseline from vitest.config.ts coverage.exclude
const REQUIRED_TEST_EXCLUDE = '.worktrees/**';

function parseConfig() {
  const content = readFileSync(configPath, 'utf8');

  // Extract thresholds
  const thresholdsMatch = content.match(/thresholds:\s*\{([^}]+)}/s);
  if (!thresholdsMatch) {
    throw new Error('Cannot parse coverage thresholds');
  }

  const thresholds = {};
  const thresholdContent = thresholdsMatch[1];
  for (const key of Object.keys(REQUIRED_THRESHOLDS)) {
    const match = thresholdContent.match(new RegExp(`${key}:\\s*(\\d+)`));
    if (match) {
      thresholds[key] = parseInt(match[1], 10);
    }
  }

  // Count exclusions in coverage.exclude (not test.exclude)
  const excludeMatch = content.match(/coverage:\s*\{[\s\S]*?exclude:\s*\[([\s\S]*?)]/);
  if (!excludeMatch) {
    throw new Error('Cannot parse coverage exclusions');
  }

  const exclusionLines = excludeMatch[1]
    .split('\n')
    .filter((line) => line.trim().startsWith("'") || line.trim().startsWith('"'))
    .filter((line) => !line.trim().startsWith('//'));

  // Extract root test.exclude so nested local checkouts cannot be discovered.
  const testExcludeMatch = content.match(/test:\s*\{[\s\S]*?exclude:\s*\[([\s\S]*?)]/);
  if (!testExcludeMatch) {
    throw new Error('Cannot parse test exclusions');
  }

  const testExcludes = testExcludeMatch[1]
    .split('\n')
    .map((line) => line.trim().replace(/,$/, ''))
    .filter((line) => line.startsWith("'") || line.startsWith('"'))
    .map((line) => line.slice(1, -1));

  return { thresholds, exclusionCount: exclusionLines.length, testExcludes };
}

// Main execution
console.log('Verifying vitest.config.ts protection...\n');

try {
  const { thresholds, exclusionCount, testExcludes } = parseConfig();
  const violations = [];

  for (const [key, required] of Object.entries(REQUIRED_THRESHOLDS)) {
    const actual = thresholds[key];
    if (actual === undefined) {
      violations.push(`Missing threshold: ${key}`);
    } else if (actual < required) {
      violations.push(`${key}: ${String(actual)} (required: ${String(required)})`);
    }
  }

  if (exclusionCount > MAX_EXCLUSIONS) {
    violations.push(`Exclusion count: ${String(exclusionCount)} (max: ${String(MAX_EXCLUSIONS)})`);
  }

  if (!testExcludes.includes(REQUIRED_TEST_EXCLUDE)) {
    violations.push(`Missing root test.exclude pattern: ${REQUIRED_TEST_EXCLUDE}`);
  }

  if (violations.length > 0) {
    console.error('❌ VITEST CONFIG VIOLATIONS\n');
    console.error('Coverage settings have been weakened:\n');
    for (const v of violations) {
      console.error(`  - ${v}`);
    }
    console.error('\nABSOLUTE RULE: NEVER modify vitest.config.ts coverage settings.');
    console.error('Write tests to achieve coverage instead.\n');
    process.exit(1);
  }

  console.log('✓ Coverage thresholds: all at 95%');
  console.log(`✓ Exclusion count: ${String(exclusionCount)}/${String(MAX_EXCLUSIONS)}\n`);
  console.log(`✓ Root test exclusion: ${REQUIRED_TEST_EXCLUDE}\n`);
  process.exit(0);
} catch (error) {
  console.error(
    `❌ Verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`
  );
  process.exit(1);
}
