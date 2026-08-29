#!/usr/bin/env node

import { lstatSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const HOME_DEV_RUNTIME_MODE_FILE = '/var/lib/intexuraos-dev/runtime-mode.env';
export const HOME_DEV_RUNTIME_START_LOCK = '/var/lib/intexuraos-dev/runtime-start.lock';

const ACTIVE_MODES = new Set(['active-pre-cutover', 'active-post-cutover']);
const KNOWN_MODES = new Set([
  ...ACTIVE_MODES,
  'draining',
  'hibernated',
  'resuming',
  'recovery-required',
]);

function deny(message) {
  const error = new Error(`Home Dev runtime start denied: ${message}`);
  error.code = 'HOME_DEV_RUNTIME_START_DENIED';
  throw error;
}

export function assertHomeDevRuntimeLockSafe({
  lockFile = HOME_DEV_RUNTIME_START_LOCK,
  expectedUid = 0,
  expectedGid = 0,
} = {}) {
  let metadata;
  try {
    metadata = lstatSync(lockFile);
  } catch {
    deny('runtime lock cannot be inspected');
  }
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    metadata.uid !== expectedUid ||
    metadata.gid !== expectedGid ||
    (metadata.mode & 0o7777) !== 0o644 ||
    metadata.size !== 0
  ) {
    deny('unsafe runtime lock metadata');
  }
}

export function parseHomeDevRuntimeMode(bytes) {
  const fields = new Map();
  const lines = bytes.endsWith('\n') ? bytes.slice(0, -1).split('\n') : [];

  for (const line of lines) {
    const separator = line.indexOf('=');
    if (separator <= 0) deny('malformed mode record');
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (value.length === 0 || fields.has(key)) deny('malformed mode record');
    fields.set(key, value);
  }

  const expectedKeys = ['MODE', 'REVISION', 'UPDATED_AT', 'EVIDENCE_RUN_ID'];
  if (fields.size !== expectedKeys.length || expectedKeys.some((key) => !fields.has(key))) {
    deny('malformed mode record');
  }

  const mode = fields.get('MODE');
  if (!KNOWN_MODES.has(mode)) deny('unknown mode');
  if (!/^[0-9a-f]{40}$/u.test(fields.get('REVISION'))) deny('invalid revision');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(fields.get('UPDATED_AT'))) {
    deny('invalid timestamp');
  }
  if (!/^\d{8}T\d{6}Z-p[0-9a-f]{12}-b[0-9a-f]{12}$/u.test(fields.get('EVIDENCE_RUN_ID'))) {
    deny('invalid evidence run ID');
  }

  return mode;
}

export function assertHomeDevRuntimeStartAllowed({
  stateFile = HOME_DEV_RUNTIME_MODE_FILE,
  expectedUid = 0,
  expectedGid = 0,
} = {}) {
  let metadata;
  try {
    metadata = lstatSync(stateFile);
  } catch (error) {
    if (error?.code === 'ENOENT') return { enforced: false, mode: null };
    deny('mode record cannot be inspected');
  }

  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    metadata.uid !== expectedUid ||
    metadata.gid !== expectedGid ||
    (metadata.mode & 0o7777) !== 0o644
  ) {
    deny('unsafe mode record metadata');
  }

  let mode;
  try {
    mode = parseHomeDevRuntimeMode(readFileSync(stateFile, 'utf8'));
  } catch (error) {
    if (error?.code === 'HOME_DEV_RUNTIME_START_DENIED') throw error;
    deny('mode record cannot be read');
  }

  if (!ACTIVE_MODES.has(mode)) deny(`MODE=${mode}`);
  return { enforced: true, mode };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.length !== 2) {
    console.error('assert-home-dev-runtime-start: arguments are forbidden');
    process.exitCode = 64;
  } else {
    try {
      assertHomeDevRuntimeLockSafe();
      assertHomeDevRuntimeStartAllowed();
    } catch (error) {
      console.error(`assert-home-dev-runtime-start: ${error.message}`);
      process.exitCode = 78;
    }
  }
}
