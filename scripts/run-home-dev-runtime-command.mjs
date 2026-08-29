#!/usr/bin/env node

import { lstatSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  HOME_DEV_RUNTIME_MODE_FILE,
  HOME_DEV_RUNTIME_START_LOCK,
  assertHomeDevRuntimeLockSafe,
} from './assert-home-dev-runtime-start.mjs';

const FLOCK_COMMAND = '/usr/bin/flock';
const BASH_COMMAND = '/bin/bash';
const ENV_COMMAND = '/usr/bin/env';
const assertScriptPath = fileURLToPath(
  new URL('./assert-home-dev-runtime-start.mjs', import.meta.url)
);
const lockedCommandScript = `set -eu
"$1" -i PATH=/usr/bin:/bin LANG=C LC_ALL=C "$2" "$3"
shift 3
exec "$@"
`;

function inspectPath(path, label) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new Error(`Home Dev runtime start denied: ${label} cannot be inspected`);
  }
}

function shellSafeOptions(options) {
  const environment = { ...(options.env ?? process.env) };
  for (const name of ['BASH_ENV', 'ENV', 'SHELLOPTS', 'BASHOPTS']) delete environment[name];
  return { ...options, env: environment };
}

function spawn(command, args, options) {
  const result = spawnSync(command, args, options);
  if (result.error) throw result.error;
  return result;
}

export function runHomeDevRuntimeCommand(command, args = [], options = {}) {
  if (typeof command !== 'string' || command.length === 0 || command.includes('\0')) {
    throw new Error('runtime command must be a non-empty executable name');
  }
  if (!Array.isArray(args) || args.some((argument) => typeof argument !== 'string')) {
    throw new Error('runtime command arguments must be strings');
  }

  const lockMetadata = inspectPath(HOME_DEV_RUNTIME_START_LOCK, 'runtime lock');
  const stateMetadata = inspectPath(HOME_DEV_RUNTIME_MODE_FILE, 'mode record');
  if (lockMetadata === null && stateMetadata === null) {
    return spawn(command, args, options);
  }
  if (lockMetadata === null) {
    throw new Error('Home Dev runtime start denied: runtime lock is missing');
  }

  assertHomeDevRuntimeLockSafe();
  return spawn(
    FLOCK_COMMAND,
    [
      '--shared',
      '--',
      HOME_DEV_RUNTIME_START_LOCK,
      ENV_COMMAND,
      '-u',
      'BASH_ENV',
      '-u',
      'ENV',
      '-u',
      'SHELLOPTS',
      '-u',
      'BASHOPTS',
      BASH_COMMAND,
      '--noprofile',
      '--norc',
      '-c',
      lockedCommandScript,
      'intexuraos-runtime-lock',
      ENV_COMMAND,
      process.execPath,
      assertScriptPath,
      command,
      ...args,
    ],
    shellSafeOptions(options)
  );
}

function finish(result) {
  if (result.signal) {
    console.error(`run-home-dev-runtime-command: child terminated by ${result.signal}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const input = process.argv.slice(2);
  try {
    const command = input[0];
    if (!command) throw new Error('runtime command is required');
    finish(runHomeDevRuntimeCommand(command, input.slice(1), { stdio: 'inherit' }));
  } catch (error) {
    console.error(`run-home-dev-runtime-command: ${error.message}`);
    process.exitCode = error?.code === 'HOME_DEV_RUNTIME_START_DENIED' ? 78 : 1;
  }
}
