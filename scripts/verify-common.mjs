#!/usr/bin/env node
/**
 * Verify that packages/common-core contains only cross-cutting utilities.
 * Fails if domain-specific keywords are detected (common dumping prevention).
 *
 * This is a conservative heuristic check. False positives are acceptable
 * in early stages - they force explicit review of what belongs in common.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const commonSrcDir = join(repoRoot, 'packages', 'common-core', 'src');

// Keywords that indicate domain leakage into common-core
// These are domain-specific concepts that should NOT be in common-core
// Note: Infrastructure clients (Firestore, Notion) are allowed as reusable utilities
const FORBIDDEN_KEYWORDS = [
  // Domain models from apps
  'Action', // actions-agent domain
  'Command', // commands-agent domain
  'Research', // research-agent domain
  'Notification', // mobile-notifications-service domain
  'Note', // notes-agent domain
  'Feed', // data-insights-agent domain
  'DataSource', // data-insights-agent domain
  'Message', // whatsapp-service domain
  'Webhook', // whatsapp-service domain
  // External service specific
  'Auth0',
  'WhatsApp',
  'Notion',
  // Domain-specific concepts
  'PromptVault',
  'Workspace',
  'Block',
  'Session',
  'Permission',
  'Role',
];

// Allowed contexts where keywords might appear legitimately
// (e.g., in comments explaining what NOT to put here)
const ALLOWED_CONTEXTS = [
  /\/\/.*forbidden/i,
  /\/\/.*not allowed/i,
  /\/\/.*do not/i,
  /\/\*[\s\S]*?\*\//, // Block comments (for documentation)
  /"[^"]*"/, // String literals (for error messages)
  /'[^']*'/, // String literals
  /`[^`]*`/, // Template literals
];

/**
 * Recursively get all TypeScript files in a directory
 */
function getTypeScriptFiles(dir) {
  const files = [];

  try {
    const entries = readdirSync(dir);

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        // Skip test directories for this check
        if (entry === '__tests__' || entry === 'node_modules') {
          continue;
        }
        files.push(...getTypeScriptFiles(fullPath));
      } else if (
        entry.endsWith('.ts') &&
        !entry.endsWith('.test.ts') &&
        !entry.endsWith('.spec.ts')
      ) {
        files.push(fullPath);
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return files;
}

/**
 * Remove allowed contexts from content to avoid false positives
 */
function stripAllowedContexts(content) {
  let stripped = content;
  for (const pattern of ALLOWED_CONTEXTS) {
    stripped = stripped.replace(new RegExp(pattern, 'g'), ' ');
  }
  return stripped;
}

/**
 * Check a file for forbidden keywords
 */
function checkFile(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const strippedContent = stripAllowedContexts(content);
  const lines = strippedContent.split('\n');
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const keyword of FORBIDDEN_KEYWORDS) {
      // Match as whole word (not part of another word)
      const regex = new RegExp(`\\b${keyword}\\b`, 'g');
      if (regex.test(line)) {
        violations.push({
          line: i + 1,
          keyword,
          content: line.trim().slice(0, 80),
        });
      }
    }
  }

  return violations;
}

// Main
const files = getTypeScriptFiles(commonSrcDir);
const allViolations = [];

for (const file of files) {
  const violations = checkFile(file);
  if (violations.length > 0) {
    const relativePath = file.replace(repoRoot + '/', '');
    allViolations.push({ file: relativePath, violations });
  }
}

if (allViolations.length > 0) {
  console.error('❌ COMMON DUMPING DETECTED\n');
  console.error('The following files contain domain-specific keywords that');
  console.error('should NOT be in packages/common-core:\n');

  for (const { file, violations } of allViolations) {
    console.error(`  ${file}:`);
    for (const v of violations) {
      console.error(`    Line ${v.line}: found "${v.keyword}"`);
      console.error(`      ${v.content}`);
    }
    console.error('');
  }

  console.error('Common package should only contain cross-cutting utilities:');
  console.error('  - Result/Either types');
  console.error('  - Error base classes');
  console.error('  - Crypto primitives');
  console.error('  - Logging types');
  console.error('  - Generic type utilities\n');

  console.error('Move domain-specific code to the appropriate domain package.');
  console.error('See: docs/architecture/package-contracts.md\n');

  process.exit(1);
} else {
  console.log('✓ Common package verification passed');
  console.log(`  Scanned ${files.length} file(s)`);
  console.log('  No domain leakage detected');
  process.exit(0);
}
