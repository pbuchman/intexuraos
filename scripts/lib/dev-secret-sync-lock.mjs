#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { hostname, platform } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CLAIM_PATTERN =
  /^claim-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u;
const PREPARING_PATTERN =
  /^\.preparing-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u;
const PREPARING_OWNER_PATTERN =
  /^\.preparing-owner-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/u;
const RELEASING_PATTERN =
  /^\.releasing-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u;
const OWNER_TEMP_PATTERN =
  /^\.sync-lock-owner-temp-([0-9a-f]{16})-([0-9a-f]{16})-([1-9][0-9]*)-([0-9a-f]{16})-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u;
const OWNER_KEYS = [
  'bootMarker',
  'hostname',
  'ownerPid',
  'processStartMarker',
  'schemaVersion',
  'syncScript',
  'token',
  'workDirectoryName',
].sort();
const WAIT_BUFFER = new Int32Array(new SharedArrayBuffer(4));
const TEST_FAILPOINTS = new Set([
  '',
  'after-preparing-directory',
  'after-preparing-owner-open',
  'hold-after-preparing-owner',
]);

function fail() {
  throw new Error('DEV secret-package sync lock failed');
}

function sleep(milliseconds) {
  Atomics.wait(WAIT_BUFFER, 0, 0, milliseconds);
}

function triggerTestFailpoint(name) {
  const selected = process.env.INTEXURAOS_SECRET_SYNC_LOCK_TEST_FAILPOINT ?? '';
  if (!TEST_FAILPOINTS.has(selected)) fail();
  if (selected === 'hold-after-preparing-owner') {
    if (name !== 'after-preparing-owner') return;
    if (process.env.NODE_ENV !== 'test') fail();
    const releasePath = process.env.INTEXURAOS_SECRET_SYNC_LOCK_TEST_RELEASE_FILE;
    if (typeof releasePath !== 'string' || !isAbsolute(releasePath)) fail();
    const deadline = Date.now() + 10_000;
    while (!existsSync(releasePath)) {
      if (Date.now() >= deadline) fail();
      sleep(20);
    }
    if (readPrivateFile(releasePath) !== 'release\n') fail();
    return;
  }
  if (selected !== name) return;
  if (process.env.NODE_ENV !== 'test') fail();
  process.kill(process.pid, 'SIGKILL');
}

function syncDirectory(path) {
  const descriptor = openSync(path, 'r');
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function validatePrivateDirectory(path) {
  let status;
  try {
    status = lstatSync(path);
  } catch {
    fail();
  }
  if (!status.isDirectory() || status.isSymbolicLink() || (status.mode & 0o777) !== 0o700) {
    fail();
  }
}

function preparePrivateDirectory(path, recursive) {
  try {
    mkdirSync(path, { mode: 0o700, recursive });
  } catch (error) {
    if (error === null || typeof error !== 'object' || error.code !== 'EEXIST') fail();
  }
  let status;
  try {
    status = lstatSync(path);
  } catch {
    fail();
  }
  if (!status.isDirectory() || status.isSymbolicLink()) fail();
  chmodSync(path, 0o700);
  validatePrivateDirectory(path);
}

function readPrivateFile(path) {
  let descriptor;
  try {
    const status = lstatSync(path);
    if (!status.isFile() || status.isSymbolicLink() || (status.mode & 0o777) !== 0o600) fail();
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const openedStatus = fstatSync(descriptor);
    if (
      !openedStatus.isFile() ||
      (openedStatus.mode & 0o777) !== 0o600 ||
      openedStatus.dev !== status.dev ||
      openedStatus.ino !== status.ino
    ) {
      fail();
    }
    return readFileSync(descriptor, 'utf8');
  } catch {
    fail();
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function writePrivateFile(path, value, afterOpen) {
  const descriptor = openSync(path, 'wx', 0o600);
  try {
    if (afterOpen !== undefined) afterOpen();
    writeFileSync(descriptor, value);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  chmodSync(path, 0o600);
}

function currentBootMarker() {
  try {
    if (platform() === 'linux') {
      return readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    }
    if (platform() === 'darwin') {
      return execFileSync('sysctl', ['-n', 'kern.boottime'], { encoding: 'utf8' }).trim();
    }
  } catch {
    fail();
  }
  fail();
}

function inspectProcess(pid) {
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'ESRCH') return undefined;
    fail();
  }
  try {
    if (platform() === 'linux') {
      const stat = readFileSync(`/proc/${String(pid)}/stat`, 'utf8');
      const commandEnd = stat.lastIndexOf(')');
      if (commandEnd < 0) fail();
      const fieldsAfterCommand = stat
        .slice(commandEnd + 2)
        .trim()
        .split(/\s+/u);
      const processStartMarker = fieldsAfterCommand[19];
      if (processStartMarker === undefined || !/^[0-9]+$/u.test(processStartMarker)) fail();
      const command = readFileSync(`/proc/${String(pid)}/cmdline`)
        .toString('utf8')
        .split('\0')
        .filter((part) => part.length > 0)
        .join(' ');
      return { command, processStartMarker };
    }
    if (platform() === 'darwin') {
      const processStartMarker = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
        encoding: 'utf8',
      }).trim();
      const command = execFileSync('ps', ['-ww', '-o', 'command=', '-p', String(pid)], {
        encoding: 'utf8',
      }).trim();
      if (processStartMarker.length === 0 || command.length === 0) return undefined;
      return { command, processStartMarker };
    }
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'ENOENT') return undefined;
    if (error !== null && typeof error === 'object' && error.status === 1) return undefined;
    fail();
  }
  fail();
}

function parseOwnerFile(path, expectedToken) {
  let owner;
  try {
    owner = JSON.parse(readPrivateFile(path));
  } catch {
    fail();
  }
  if (
    owner === null ||
    typeof owner !== 'object' ||
    Array.isArray(owner) ||
    JSON.stringify(Object.keys(owner).sort()) !== JSON.stringify(OWNER_KEYS) ||
    owner.schemaVersion !== 1 ||
    owner.token !== expectedToken ||
    !TOKEN_PATTERN.test(owner.token) ||
    !Number.isSafeInteger(owner.ownerPid) ||
    owner.ownerPid <= 0 ||
    typeof owner.hostname !== 'string' ||
    owner.hostname.length === 0 ||
    typeof owner.bootMarker !== 'string' ||
    owner.bootMarker.length === 0 ||
    typeof owner.processStartMarker !== 'string' ||
    owner.processStartMarker.length === 0 ||
    typeof owner.syncScript !== 'string' ||
    !isAbsolute(owner.syncScript) ||
    owner.workDirectoryName !== `.sync-work.${expectedToken}`
  ) {
    fail();
  }
  return owner;
}

function parseOwner(claimPath, expectedToken) {
  validatePrivateDirectory(claimPath);
  return parseOwnerFile(join(claimPath, 'owner.json'), expectedToken);
}

function ownerState(owner, context) {
  if (owner.hostname !== context.hostname) return { owner, state: 'indeterminate' };
  if (owner.bootMarker !== context.bootMarker) return { owner, state: 'stale' };
  const identity = inspectProcess(owner.ownerPid);
  if (identity === undefined) return { owner, state: 'stale' };
  if (
    identity.processStartMarker !== owner.processStartMarker ||
    !identity.command.includes(basename(owner.syncScript))
  ) {
    return { owner, state: 'stale' };
  }
  return { owner, state: 'active' };
}

function claimState(claimPath, token, context) {
  return ownerState(parseOwner(claimPath, token), context);
}

function readTicket(claimPath) {
  const path = join(claimPath, 'ticket');
  if (!existsSync(path)) return undefined;
  const value = readPrivateFile(path).trim();
  if (!/^[1-9][0-9]*$/u.test(value) || !Number.isSafeInteger(Number(value))) fail();
  return Number(value);
}

function removeStalePaths(context, paths, owner) {
  for (const path of [...paths, preparingOwnerTemporaryPath(context, owner)]) {
    try {
      rmSync(path, { force: true, recursive: true });
    } catch (error) {
      if (error === null || typeof error !== 'object' || error.code !== 'ENOENT') fail();
    }
  }
  const workPath = join(context.packageRoot, owner.workDirectoryName);
  if (workPath !== join(context.packageRoot, `.sync-work.${owner.token}`)) fail();
  rmSync(workPath, { force: true, recursive: true });
  syncDirectory(context.lockRoot);
}

function preparingOwnerPath(context, token) {
  return join(context.lockRoot, `.preparing-owner-${token}.json`);
}

function identityDigest(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16);
}

function preparingOwnerTemporaryPath(context, owner) {
  return join(
    context.packageRoot,
    [
      '.sync-lock-owner-temp',
      identityDigest(owner.hostname),
      identityDigest(owner.bootMarker),
      String(owner.ownerPid),
      identityDigest(owner.processStartMarker),
      owner.token,
    ].join('-')
  );
}

function scavengeOwnerTemporaries(context) {
  let changed = false;
  let names;
  try {
    names = readdirSync(context.packageRoot);
  } catch {
    fail();
  }
  for (const name of names) {
    if (!name.startsWith('.sync-lock-owner-temp-')) continue;
    const match = OWNER_TEMP_PATTERN.exec(name);
    if (match === null) fail();
    const [, ownerHostname, ownerBootMarker, ownerPidValue, ownerStartMarker] = match;
    const path = join(context.packageRoot, name);
    let status;
    try {
      status = lstatSync(path);
    } catch {
      continue;
    }
    if (!status.isFile() || status.isSymbolicLink() || (status.mode & 0o777) !== 0o600) fail();
    if (ownerHostname !== identityDigest(context.hostname)) fail();
    const ownerPid = Number(ownerPidValue);
    let stale = ownerBootMarker !== identityDigest(context.bootMarker);
    if (!stale) {
      const identity = inspectProcess(ownerPid);
      stale =
        identity === undefined || ownerStartMarker !== identityDigest(identity.processStartMarker);
    }
    if (!stale) continue;
    rmSync(path, { force: true });
    changed = true;
  }
  if (changed) syncDirectory(context.packageRoot);
}

function scavengeReleasedClaims(context) {
  let changed = false;
  let names;
  try {
    names = readdirSync(context.lockRoot);
  } catch {
    fail();
  }
  for (const name of names) {
    if (!name.startsWith('.releasing-')) continue;
    if (RELEASING_PATTERN.exec(name) === null) fail();
    rmSync(join(context.lockRoot, name), { force: true, recursive: true });
    changed = true;
  }
  if (changed) syncDirectory(context.lockRoot);
}

function readPreparingOwner(context, preparingPath, token) {
  validatePrivateDirectory(preparingPath);
  const installedPath = join(preparingPath, 'owner.json');
  const stagedPath = preparingOwnerPath(context, token);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    for (const path of [installedPath, stagedPath]) {
      if (!existsSync(path)) continue;
      try {
        return parseOwnerFile(path, token);
      } catch (error) {
        if (!existsSync(path)) continue;
        throw error;
      }
    }
    if (!existsSync(preparingPath)) return undefined;
  }
  fail();
}

function scanClaims(context) {
  const claims = [];
  let names;
  try {
    names = readdirSync(context.lockRoot).sort();
  } catch {
    fail();
  }
  const entries = names.map((name) => {
    const matches = [
      { kind: 'claim', match: CLAIM_PATTERN.exec(name) },
      { kind: 'preparing', match: PREPARING_PATTERN.exec(name) },
      { kind: 'preparing-owner', match: PREPARING_OWNER_PATTERN.exec(name) },
      { kind: 'releasing', match: RELEASING_PATTERN.exec(name) },
    ].filter((entry) => entry.match !== null);
    if (matches.length !== 1 || matches[0]?.match?.[1] === undefined) fail();
    return { kind: matches[0].kind, name, token: matches[0].match[1] };
  });
  const preparingTokens = new Set(
    entries.filter((entry) => entry.kind === 'preparing').map((entry) => entry.token)
  );
  for (const entry of entries) {
    const { kind, name, token } = entry;
    if (kind === 'releasing') continue;
    if (kind === 'preparing-owner' && preparingTokens.has(token)) continue;
    const claimPath = join(context.lockRoot, name);
    let state;
    try {
      if (kind === 'preparing') {
        const owner = readPreparingOwner(context, claimPath, token);
        if (owner === undefined) continue;
        state = ownerState(owner, context);
      } else if (kind === 'preparing-owner') {
        if (!existsSync(claimPath)) continue;
        state = ownerState(parseOwnerFile(claimPath, token), context);
      } else {
        state = claimState(claimPath, token, context);
      }
    } catch (error) {
      if (!existsSync(claimPath)) continue;
      throw error;
    }
    if (state.state === 'stale') {
      removeStalePaths(
        context,
        kind === 'preparing' ? [claimPath, preparingOwnerPath(context, token)] : [claimPath],
        state.owner
      );
      continue;
    }
    if (state.state === 'indeterminate') fail();
    if (kind === 'claim') {
      try {
        claims.push({ claimPath, ticket: readTicket(claimPath), token });
      } catch (error) {
        if (!existsSync(claimPath)) continue;
        throw error;
      }
    } else {
      claims.push({ claimPath, ticket: undefined, token });
    }
  }
  return claims;
}

function ownerFor(options, context) {
  const identity = inspectProcess(options.ownerPid);
  if (
    identity === undefined ||
    !identity.command.includes(basename(options.syncScript)) ||
    options.syncScript !== context.syncScript
  ) {
    fail();
  }
  return {
    schemaVersion: 1,
    token: options.ownerToken,
    ownerPid: options.ownerPid,
    hostname: context.hostname,
    bootMarker: context.bootMarker,
    processStartMarker: identity.processStartMarker,
    syncScript: context.syncScript,
    workDirectoryName: `.sync-work.${options.ownerToken}`,
  };
}

function createClaim(options, context) {
  const preparingPath = join(context.lockRoot, `.preparing-${options.ownerToken}`);
  const stagedOwnerPath = preparingOwnerPath(context, options.ownerToken);
  const owner = ownerFor(options, context);
  const temporaryOwnerPath = preparingOwnerTemporaryPath(context, owner);
  const claimPath = join(context.lockRoot, `claim-${options.ownerToken}`);
  try {
    writePrivateFile(temporaryOwnerPath, `${JSON.stringify(owner)}\n`, () =>
      triggerTestFailpoint('after-preparing-owner-open')
    );
    try {
      linkSync(temporaryOwnerPath, stagedOwnerPath);
    } catch {
      fail();
    }
    syncDirectory(context.lockRoot);
    rmSync(temporaryOwnerPath);
    syncDirectory(context.packageRoot);
    triggerTestFailpoint('after-preparing-owner');
    mkdirSync(preparingPath, { mode: 0o700 });
    chmodSync(preparingPath, 0o700);
    triggerTestFailpoint('after-preparing-directory');
    renameSync(stagedOwnerPath, join(preparingPath, 'owner.json'));
    syncDirectory(preparingPath);
    renameSync(preparingPath, claimPath);
    syncDirectory(context.lockRoot);
    return claimPath;
  } catch {
    rmSync(preparingPath, { force: true, recursive: true });
    rmSync(stagedOwnerPath, { force: true });
    rmSync(temporaryOwnerPath, { force: true });
    syncDirectory(context.lockRoot);
    syncDirectory(context.packageRoot);
    fail();
  }
}

function chooseTicket(context, ownClaimPath) {
  const maximum = scanClaims(context).reduce(
    (current, claim) => Math.max(current, claim.ticket ?? 0),
    0
  );
  if (!Number.isSafeInteger(maximum + 1)) fail();
  const ticket = maximum + 1;
  writePrivateFile(join(ownClaimPath, 'ticket'), `${String(ticket)}\n`);
  syncDirectory(ownClaimPath);
  return ticket;
}

function acquire(options) {
  preparePrivateDirectory(options.packageRoot, true);
  preparePrivateDirectory(options.lockRoot, false);
  const context = {
    bootMarker: currentBootMarker(),
    hostname: hostname(),
    lockRoot: options.lockRoot,
    packageRoot: options.packageRoot,
    syncScript: options.syncScript,
  };
  scavengeOwnerTemporaries(context);
  scavengeReleasedClaims(context);
  const ownClaimPath = createClaim(options, context);
  try {
    const ownTicket = chooseTicket(context, ownClaimPath);
    const timeout = Number(process.env.INTEXURAOS_SECRET_SYNC_LOCK_TIMEOUT_MS ?? '600000');
    if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 3_600_000) fail();
    const deadline = Date.now() + timeout;
    while (true) {
      const blocked = scanClaims(context).some(
        (claim) =>
          claim.token !== options.ownerToken &&
          (claim.ticket === undefined ||
            claim.ticket < ownTicket ||
            (claim.ticket === ownTicket && claim.token < options.ownerToken))
      );
      if (!blocked) return;
      if (Date.now() >= deadline) fail();
      sleep(50);
    }
  } catch {
    rmSync(ownClaimPath, { force: true, recursive: true });
    syncDirectory(context.lockRoot);
    fail();
  }
}

function release(options) {
  if (!existsSync(options.lockRoot)) return;
  validatePrivateDirectory(options.lockRoot);
  const claimPath = join(options.lockRoot, `claim-${options.ownerToken}`);
  if (!existsSync(claimPath)) return;
  const owner = parseOwner(claimPath, options.ownerToken);
  if (owner.ownerPid !== options.ownerPid || owner.syncScript !== options.syncScript) fail();
  const releasingPath = join(options.lockRoot, `.releasing-${options.ownerToken}`);
  renameSync(claimPath, releasingPath);
  syncDirectory(options.lockRoot);
  rmSync(releasingPath, { recursive: true });
  syncDirectory(options.lockRoot);
}

function normalizeWriterOptions(options) {
  const ownerPid = options?.ownerPid ?? process.pid;
  const ownerToken = options?.ownerToken ?? randomUUID();
  const packageRoot = resolve(options?.packageRoot);
  const syncScript = resolve(options?.writerEntryPoint);
  if (
    !Number.isSafeInteger(ownerPid) ||
    ownerPid <= 0 ||
    !TOKEN_PATTERN.test(ownerToken) ||
    !isAbsolute(packageRoot) ||
    !isAbsolute(syncScript)
  ) {
    fail();
  }
  return {
    lockRoot: join(packageRoot, '.sync-lock'),
    ownerPid,
    ownerToken,
    packageRoot,
    syncScript,
  };
}

export function acquireDevSecretWriterLock(options) {
  const normalized = normalizeWriterOptions(options);
  acquire(normalized);
  return {
    ownerPid: normalized.ownerPid,
    ownerToken: normalized.ownerToken,
    packageRoot: normalized.packageRoot,
    writerEntryPoint: normalized.syncScript,
  };
}

export function releaseDevSecretWriterLock(lock) {
  release(normalizeWriterOptions(lock));
}

function parseArguments(argv) {
  const [command, ...tokens] = argv;
  if (command === 'create-token' && tokens.length === 0) return { command };
  if (command !== 'acquire' && command !== 'release') fail();
  const values = new Map();
  for (let index = 0; index < tokens.length; index += 2) {
    const name = tokens[index];
    const value = tokens[index + 1];
    if (
      typeof name !== 'string' ||
      !name.startsWith('--') ||
      typeof value !== 'string' ||
      value.length === 0 ||
      values.has(name)
    ) {
      fail();
    }
    values.set(name, value);
  }
  const expected = ['--owner-pid', '--owner-token', '--package-root', '--sync-script'];
  if (values.size !== expected.length || expected.some((name) => !values.has(name))) fail();
  const ownerPid = Number(values.get('--owner-pid'));
  const ownerToken = values.get('--owner-token');
  const packageRoot = resolve(values.get('--package-root'));
  const syncScript = resolve(values.get('--sync-script'));
  if (
    !Number.isSafeInteger(ownerPid) ||
    ownerPid <= 0 ||
    ownerToken === undefined ||
    !TOKEN_PATTERN.test(ownerToken) ||
    !isAbsolute(packageRoot) ||
    !isAbsolute(syncScript)
  ) {
    fail();
  }
  return {
    command,
    lockRoot: join(packageRoot, '.sync-lock'),
    ownerPid,
    ownerToken,
    packageRoot,
    syncScript,
  };
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.command === 'create-token') {
      process.stdout.write(`${randomUUID()}\n`);
    } else if (options.command === 'acquire') {
      acquire(options);
    } else {
      release(options);
    }
  } catch {
    process.stderr.write('ERROR: DEV secret-package sync lock failed\n');
    process.exitCode = 1;
  }
}
