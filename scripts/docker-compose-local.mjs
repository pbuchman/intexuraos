#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDockerComposeEnv } from './lib/docker-compose-env.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const composeFile = join(rootDir, 'docker', 'docker-compose.local.yaml');
const dockerEnv = createDockerComposeEnv();

try {
  const result = spawnSync('docker', ['compose', '-f', composeFile, ...process.argv.slice(2)], {
    cwd: rootDir,
    env: dockerEnv.env,
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  process.exitCode = result.status ?? 1;
} finally {
  dockerEnv.cleanup();
}
