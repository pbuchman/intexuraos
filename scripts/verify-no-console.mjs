#!/usr/bin/env node

/**
 * Verifies that no eslint-disable comments bypass the no-console rule.
 * Console usage should be replaced with structured logging via logger parameter.
 */

import { execSync } from 'node:child_process';

const ALLOWED_PATHS = [
  // CLI tools that legitimately need console output
  'scripts/',
  'tools/',
  // TODO: Migrate these packages to use logger parameter (tech debt)
  'packages/infra-gemini/',
  'packages/infra-claude/',
  'packages/infra-gpt/',
  // Leaf packages that log directly to Firestore + Cloud Logging (no DI)
  'packages/llm-audit/',
  'packages/llm-pricing/',
];

function main() {
  try {
    const result = execSync(
      'grep -r "eslint-disable.*no-console" --include="*.ts" --include="*.tsx" apps/ packages/ || true',
      { encoding: 'utf-8' }
    );

    if (!result.trim()) {
      console.log('✅ No eslint-disable no-console violations found');
      process.exit(0);
    }

    const violations = result
      .trim()
      .split('\n')
      .filter((line) => !ALLOWED_PATHS.some((allowed) => line.startsWith(allowed)));

    if (violations.length === 0) {
      console.log('✅ No eslint-disable no-console violations found');
      process.exit(0);
    }

    console.error('❌ Found eslint-disable no-console violations:\n');
    violations.forEach((v) => console.error(`  ${v}`));
    console.error(
      '\n💡 Fix: Accept a logger parameter and use structured logging instead of console.*'
    );
    console.error('   See: apps/image-service/src/infra/llm/GptPromptAdapter.ts for example\n');
    process.exit(1);
  } catch (error) {
    console.error('Error running verification:', error.message);
    process.exit(1);
  }
}

main();
