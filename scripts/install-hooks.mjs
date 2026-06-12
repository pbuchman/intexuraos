#!/usr/bin/env node
/**
 * Git Hooks Installer
 *
 * Creates:
 * - pre-commit hook to block vitest.config.ts modifications
 * - pre-push hook to run Firestore migration/artifact verification
 */

import { writeFileSync, chmodSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const gitHooksDir = join(repoRoot, '.git', 'hooks');

export function buildHookFiles() {
  return {
    'pre-commit': `#!/bin/sh
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
`,
    'pre-push': `#!/bin/sh
set -eu

pnpm verify:migrations
pnpm verify:firestore-artifacts
`,
  };
}

function installHooks() {
  console.log('Installing git hooks...\n');

  if (!existsSync(gitHooksDir)) {
    console.error('❌ .git/hooks directory not found');
    console.error('   This script must be run from a git repository.\n');
    process.exit(1);
  }

  try {
    for (const [fileName, content] of Object.entries(buildHookFiles())) {
      const hookPath = join(gitHooksDir, fileName);
      writeFileSync(hookPath, content);
      chmodSync(hookPath, 0o755);
      console.log(`✓ Git ${fileName} hook installed`);
      console.log(`  Location: ${hookPath}`);
    }
    console.log('');
  } catch (error) {
    console.error(
      `❌ Failed to install hook: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    process.exit(1);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  installHooks();
}
