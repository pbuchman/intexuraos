#!/usr/bin/env node
/**
 * Dead-code gate. Runs knip and exits non-zero if unused exports / files
 * are detected. Allowlist intentionally-kept symbols inline in knip.json
 * with a one-line rationale comment.
 */
import { spawnSync } from 'node:child_process';

const result = spawnSync('pnpm', ['exec', 'knip', '--no-progress', '--reporter', 'symbols'], {
  stdio: 'inherit',
});

if (result.status !== 0) {
  console.error('Dead-code check failed. Fix or allowlist in knip.json.');
  process.exit(result.status ?? 1);
}
