#!/usr/bin/env node

/**
 * Verifies that date formatting uses centralized utilities from @/utils/dateFormat
 * instead of scattered local implementations or toLocaleDateString calls.
 */

import { execSync } from 'node:child_process';

// Path where centralized date formatting will live
const CENTRAL_UTILS = 'apps/web/src/utils/dateFormat.ts';

// Patterns that indicate local date formatting (forbidden)
const FORBIDDEN_PATTERNS = [
  'function formatDate(',
  'function formatTime(',
  'function formatDateTime(',
  'function formatRelativeTime(',
  'function formatElapsedTime(',
  'function formatMonth(',
  'function formatWeekRange(',
  'function formatTimeOnly(',
  'const formatDate =',
  'const formatTime =',
  'const formatDateTime =',
  'const formatRelativeTime =',
  'const formatElapsedTime =',
  'const formatMonth =',
  'const formatWeekRange =',
  'const formatTimeOnly =',
];

// Paths that are allowed to have custom formatting (exceptions)
const ALLOWED_PATHS = [CENTRAL_UTILS];

function main() {
  try {
    let allViolations = [];

    // Check 1: Function definitions - run grep for each pattern
    for (const pattern of FORBIDDEN_PATTERNS) {
      try {
        const result = execSync(
          `grep -rnF --include="*.tsx" --include="*.ts" --exclude-dir=node_modules "${pattern}" apps/web/src || true`,
          { encoding: 'utf-8' }
        );
        allViolations.push(...result.trim().split('\n').filter(Boolean));
      } catch {
        // grep found nothing, continue
      }
    }

    // Check 2: toLocaleDateString and toLocaleTimeString usage
    try {
      const localeResult = execSync(
        `grep -rn "\.toLocaleDateString\|\.toLocaleTimeString" --include="*.tsx" --include="*.ts" --exclude-dir=node_modules apps/web/src || true`,
        { encoding: 'utf-8' }
      );
      allViolations.push(...localeResult.trim().split('\n').filter(Boolean));
    } catch {
      // grep found nothing, continue
    }

    // Filter out allowed paths and empty strings
    const violations = allViolations
      .filter((line) => line.trim() !== '')
      .filter((line) => !ALLOWED_PATHS.some((allowed) => line.includes(allowed)));

    if (violations.length === 0) {
      console.log('✅ No custom date formatting found');
      process.exit(0);
    }

    console.error('❌ Found custom date formatting (use @/utils/dateFormat instead):\n');
    violations.forEach((v) => console.error(`  ${v}`));
    console.error(
      '\n💡 Available utilities:\n' +
        '   formatDate(isoDate)         → "Jan 15, 2025"\n' +
        '   formatDateTime(isoDate)     → "Jan 15, 2025, 2:30 PM"\n' +
        '   formatRelative(isoDate)     → "5m ago" / "Jan 15, 2025"\n' +
        '   formatDateForInput(isoDate) → "2025-01-15"\n'
    );
    process.exit(1);
  } catch (error) {
    console.error('Error running verification:', error.message);
    process.exit(1);
  }
}

main();
