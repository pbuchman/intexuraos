#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const child = spawn(process.execPath, [resolve(repoRoot, 'scripts/ci.mjs')], {
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
