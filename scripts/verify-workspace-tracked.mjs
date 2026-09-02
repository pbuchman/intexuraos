#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('Usage: pnpm run verify:workspace:tracked <workspace-name>');
  process.exit(1);
}

const child = spawn(resolve(repoRoot, 'scripts/verify-workspace.sh'), args, {
  cwd: repoRoot,
  stdio: 'inherit',
  env: process.env,
});

child.on('error', (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
