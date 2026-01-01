#!/usr/bin/env node
/**
 * Git Hooks Installer
 *
 * Creates pre-commit hook to block vitest.config.ts modifications.
 *
 * Algorithm:
 * 1. Write pre-commit hook to .git/hooks/pre-commit
 * 2. Hook checks if vitest.config.ts is staged
 * 3. If staged, block commit with error message
 * 4. Make hook executable (chmod 755)
 */

import { writeFileSync, chmodSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const gitHooksDir = join(repoRoot, '.git', 'hooks');
const hookPath = join(gitHooksDir, 'pre-commit');

const hookContent = `#!/bin/sh
# Prevent vitest.config.ts coverage modifications

if git diff --cached --name-only | grep -q "vitest.config.ts"; then
  echo "⚠️  BLOCKED: vitest.config.ts is staged"
  echo ""
  echo "Coverage exclusions and thresholds cannot be modified."
  echo "Write tests to achieve coverage instead."
  echo ""
  echo "See: .claude/CLAUDE.md (Protected Files section)"
  exit 1
fi
`;

console.log('Installing git hooks...\n');

if (!existsSync(gitHooksDir)) {
  console.error('❌ .git/hooks directory not found');
  console.error('   This script must be run from a git repository.\n');
  process.exit(1);
}

try {
  writeFileSync(hookPath, hookContent);
  chmodSync(hookPath, 0o755);
  console.log('✓ Git pre-commit hook installed');
  console.log(`  Location: ${hookPath}`);
  console.log('  Protection: Blocks vitest.config.ts modifications\n');
  process.exit(0);
} catch (error) {
  console.error(
    `❌ Failed to install hook: ${error instanceof Error ? error.message : 'Unknown error'}`
  );
  process.exit(1);
}
