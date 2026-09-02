#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const CLAUDE_POINTER = '# CLAUDE.md\n\nRead and follow `../AGENTS.md`.\n';
const MAX_AGENTS_BYTES = 4096;

export function validateAgentInstructions(repoRoot) {
  const errors = [];
  const agentsPath = resolve(repoRoot, 'AGENTS.md');
  const claudePath = resolve(repoRoot, '.claude/CLAUDE.md');

  if (!existsSync(agentsPath)) {
    errors.push('AGENTS.md is missing');
  } else {
    const agentsContent = readFileSync(agentsPath, 'utf8');
    const agentsBytes = Buffer.byteLength(agentsContent, 'utf8');

    if (agentsBytes > MAX_AGENTS_BYTES) {
      errors.push(`AGENTS.md must be at most ${String(MAX_AGENTS_BYTES)} bytes`);
    }

    if (/\.claude\//u.test(agentsContent)) {
      errors.push('AGENTS.md must not route general rules into .claude/');
    }
  }

  if (!existsSync(claudePath)) {
    errors.push('.claude/CLAUDE.md is missing');
  } else if (readFileSync(claudePath, 'utf8') !== CLAUDE_POINTER) {
    errors.push('.claude/CLAUDE.md must be the exact compatibility pointer');
  }

  return errors;
}

const repoRoot = resolve(import.meta.dirname, '..');
const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  const errors = validateAgentInstructions(repoRoot);

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(error);
    }
    process.exitCode = 1;
  } else {
    console.log('Agent instruction contract verified.');
  }
}
