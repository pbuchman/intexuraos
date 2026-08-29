#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDockerComposeEnv } from './lib/docker-compose-env.mjs';
import { buildLocalEmulatorStartPlan } from './lib/local-emulator-lifecycle.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const composeFile = join(rootDir, 'docker', 'docker-compose.local.yaml');
const dockerEnv = createDockerComposeEnv();

function runCompose(args) {
  const result = spawnSync('docker', ['compose', '-f', composeFile, ...args], {
    cwd: rootDir,
    env: dockerEnv.env,
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  return result.status ?? 1;
}

try {
  const requestedArgs = process.argv.slice(2);
  const commands =
    requestedArgs.length === 1 && requestedArgs[0] === 'start'
      ? buildLocalEmulatorStartPlan()
      : [requestedArgs];

  for (const command of commands) {
    const status = runCompose(command);
    if (status !== 0) {
      process.exitCode = status;
      break;
    }
  }
} finally {
  dockerEnv.cleanup();
}
