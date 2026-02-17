#!/usr/bin/env node
/**
 * Validates that all @allow-* pattern suppression comments have a reason.
 * Format: // @allow-<pattern> -- <reason>
 *
 * Valid patterns:
 * - @allow-missing-js -- reason here
 * - @allow-undefined-type -- reason here
 * - @allow-result-access -- reason here
 *
 * Invalid (missing reason):
 * - @allow-missing-js
 * - @allow-missing-js --
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const VALID_PATTERNS = ['missing-js', 'undefined-type', 'result-access'];

// Find all TypeScript files (excluding node_modules, dist, .d.ts)
function findTypeScriptFiles() {
  try {
    const result = execSync(
      'find apps workers packages -type f \\( -name "*.ts" -o -name "*.tsx" \\) ' +
        '! -path "*/node_modules/*" ! -path "*/dist/*" ! -name "*.d.ts" 2>/dev/null',
      { encoding: 'utf-8' }
    );
    return result.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function validateFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const errors = [];

  lines.forEach((line, index) => {
    const lineNum = index + 1;

    // Only match our specific pattern suppression comments
    // Skip other @allow-* patterns (like @allow-raw-send from response contract)
    for (const pattern of VALID_PATTERNS) {
      const regex = new RegExp(`@allow-${pattern}(\\s|$)`);
      if (!regex.test(line)) continue;

      // Check if reason is provided (-- followed by non-whitespace)
      const reasonRegex = new RegExp(`@allow-${pattern}\\s+--\\s+\\S`);
      if (!reasonRegex.test(line)) {
        errors.push({
          file: filePath,
          line: lineNum,
          message: `Missing reason for @allow-${pattern}. Format: // @allow-${pattern} -- <reason>`,
        });
      }
    }
  });

  return errors;
}

function main() {
  console.log('Validating @allow-* pattern suppression comments...\n');

  const files = findTypeScriptFiles();
  const allErrors = [];

  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const errors = validateFile(file);
    allErrors.push(...errors);
  }

  if (allErrors.length === 0) {
    console.log('✅ All @allow-* comments have valid reasons.\n');
    process.exit(0);
  }

  console.log(`❌ Found ${allErrors.length} invalid @allow-* comment(s):\n`);
  for (const error of allErrors) {
    console.log(`${error.file}:${error.line}: ${error.message}`);
  }
  console.log('\nFormat: // @allow-<pattern> -- <reason>');
  console.log(`Valid patterns: ${VALID_PATTERNS.join(', ')}`);
  process.exit(1);
}

main();
