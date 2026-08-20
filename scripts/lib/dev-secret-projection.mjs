#!/usr/bin/env node

import { randomUUID, timingSafeEqual } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseDotenv } from 'dotenv';
import { loadSecretPackageManifest, validateSecretPackagePayload } from './secret-package.mjs';

const PROJECTION_FILES = [
  '.envrc',
  'environment.env',
  'github-app-private-key.pem',
  'metadata.json',
];
const PACKAGE_FILES = ['environment.env', 'github-app-private-key.pem', 'metadata.json'];
const NUMERIC_VERSION = /^[1-9][0-9]*$/u;
const PROJECTION_ROOT_MARKER = '.intexuraos-dev-secret-projection';
const PROJECTION_ROOT_MARKER_CONTENT = 'intexuraos-dev-secret-projection-v1\n';
const DEV_MANIFEST = loadSecretPackageManifest();
const DEV_PACKAGE = DEV_MANIFEST.packages.dev;
const DEV_METADATA_KEYS = [
  'byteLength',
  'crc32c',
  'envNames',
  'environment',
  'files',
  'schemaVersion',
  'secretId',
  'version',
].sort();
const RELEASE_NAME =
  /^(?:dev-v[1-9][0-9]*-[0-9a-f]{8}|dev-projection-v[1-9][0-9]*-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/u;
const FAILPOINTS = new Set([
  '',
  'candidate-durable',
  'compatibility-active',
  'envrc-link-installed',
  'github-link-installed',
  'before-activation',
  'after-activation',
]);

function fail() {
  throw new Error('DEV secret projection promotion failed');
}

function readArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
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
  const required = [
    '--candidate-envrc',
    '--candidate-package-dir',
    '--envrc-output',
    '--github-key-output',
    '--package-output-dir',
    '--version',
  ];
  if (values.size !== required.length || required.some((name) => !values.has(name))) fail();
  const version = values.get('--version');
  if (version === undefined || !NUMERIC_VERSION.test(version)) fail();
  return {
    candidateEnvrc: resolve(values.get('--candidate-envrc')),
    candidatePackageDir: resolve(values.get('--candidate-package-dir')),
    envrcOutput: resolve(values.get('--envrc-output')),
    githubKeyOutput: resolve(values.get('--github-key-output')),
    packageOutputDir: resolve(values.get('--package-output-dir')),
    version,
  };
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
    const value = readFileSync(descriptor);
    return value;
  } catch {
    fail();
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function writePrivateFile(path, value) {
  const descriptor = openSync(path, 'wx', 0o600);
  try {
    writeFileSync(descriptor, value);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  chmodSync(path, 0o600);
}

function syncDirectory(path) {
  const descriptor = openSync(path, 'r');
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function sameBytes(first, second) {
  return first.byteLength === second.byteLength && timingSafeEqual(first, second);
}

function readMetadata(path, expectedVersion) {
  let metadata;
  try {
    metadata = JSON.parse(readPrivateFile(path).toString('utf8'));
  } catch {
    fail();
  }
  if (
    metadata === null ||
    typeof metadata !== 'object' ||
    Array.isArray(metadata) ||
    JSON.stringify(Object.keys(metadata).sort()) !== JSON.stringify(DEV_METADATA_KEYS) ||
    metadata.schemaVersion !== 1 ||
    metadata.environment !== 'dev' ||
    metadata.secretId !== DEV_PACKAGE.secretId ||
    typeof metadata.version !== 'string' ||
    !NUMERIC_VERSION.test(metadata.version) ||
    !Number.isSafeInteger(Number(metadata.version)) ||
    !Number.isSafeInteger(metadata.byteLength) ||
    metadata.byteLength <= 0 ||
    typeof metadata.crc32c !== 'string' ||
    JSON.stringify(metadata.envNames) !== JSON.stringify(DEV_PACKAGE.envNames) ||
    JSON.stringify(metadata.files) !== JSON.stringify(['github-app-private-key.pem']) ||
    (expectedVersion !== undefined && metadata.version !== expectedVersion)
  ) {
    fail();
  }
  return metadata;
}

function validateRenderedDevPackage(path, expectedVersion) {
  const metadata = readMetadata(join(path, 'metadata.json'), expectedVersion);
  let environment;
  const environmentBytes = readPrivateFile(join(path, 'environment.env'));
  const githubKeyBytes = readPrivateFile(join(path, 'github-app-private-key.pem'));
  try {
    environment = parseDotenv(environmentBytes);
  } catch {
    fail();
  }
  if (
    JSON.stringify(Object.keys(environment).sort()) !==
    JSON.stringify([...DEV_PACKAGE.envNames].sort())
  ) {
    fail();
  }
  const canonicalEnvironment = Object.fromEntries(
    DEV_PACKAGE.envNames.map((name) => [name, environment[name]])
  );
  const payload = {
    schemaVersion: 1,
    environment: 'dev',
    env: canonicalEnvironment,
    files: {
      githubAppPrivateKeyPemBase64: githubKeyBytes.toString('base64'),
    },
  };
  let validation;
  try {
    validation = validateSecretPackagePayload({
      environment: 'dev',
      manifest: DEV_MANIFEST,
      payload,
    });
  } catch {
    fail();
  }
  if (metadata.byteLength !== validation.byteLength || metadata.crc32c !== validation.crc32c) {
    fail();
  }
  return { environment: canonicalEnvironment, githubKeyBytes, metadata };
}

function validateCompleteProjection(path, expectedVersion) {
  validateDirectory(path, PROJECTION_FILES);
  const packageProjection = validateRenderedDevPackage(path, expectedVersion);
  const envrcBytes = readPrivateFile(join(path, '.envrc'));
  let envrc;
  try {
    envrc = parseDotenv(envrcBytes);
  } catch {
    fail();
  }
  const assignedNames = [
    ...envrcBytes.toString('utf8').matchAll(/^(?:export )?([A-Z][A-Z0-9_]*)=/gmu),
  ].map((match) => match[1]);
  if (
    assignedNames.filter((name) => name === 'INTEXURAOS_SECRET_PACKAGE_VERSION').length !== 1 ||
    envrc.INTEXURAOS_SECRET_PACKAGE_VERSION !== expectedVersion ||
    DEV_PACKAGE.envNames.some(
      (name) =>
        assignedNames.filter((assignedName) => assignedName === name).length !== 1 ||
        envrc[name] !== packageProjection.environment[name]
    )
  ) {
    fail();
  }
  return packageProjection;
}

function validateDirectory(path, expectedNames) {
  let status;
  let names;
  try {
    status = lstatSync(path);
    names = readdirSync(path).sort();
  } catch {
    fail();
  }
  if (
    !status.isDirectory() ||
    status.isSymbolicLink() ||
    (status.mode & 0o777) !== 0o700 ||
    JSON.stringify(names) !== JSON.stringify([...expectedNames].sort())
  ) {
    fail();
  }
}

function stageProjection({ packageOutputDir, sources, version }) {
  let stagingPath = mkdtempSync(join(packageOutputDir, '.projection-staging-'));
  chmodSync(stagingPath, 0o700);
  const releaseName = `dev-projection-v${version}-${randomUUID()}`;
  const releasePath = join(packageOutputDir, releaseName);
  try {
    for (const name of PROJECTION_FILES) {
      const source = sources[name];
      if (typeof source !== 'string') fail();
      writePrivateFile(join(stagingPath, name), readPrivateFile(source));
    }
    validateCompleteProjection(stagingPath, version);
    syncDirectory(stagingPath);
    renameSync(stagingPath, releasePath);
    stagingPath = '';
    syncDirectory(packageOutputDir);
    return releaseName;
  } finally {
    if (stagingPath !== '') rmSync(stagingPath, { recursive: true, force: true });
  }
}

function readCurrent(packageOutputDir) {
  const currentPath = join(packageOutputDir, 'current');
  if (!existsSync(currentPath) && !lstatExists(currentPath)) return undefined;
  let status;
  let target;
  try {
    status = lstatSync(currentPath);
    target = readlinkSync(currentPath);
  } catch {
    fail();
  }
  if (!status.isSymbolicLink() || target !== basename(target) || !RELEASE_NAME.test(target)) fail();
  const releasePath = join(packageOutputDir, target);
  return { releasePath, target };
}

function lstatExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function resolveLocationThroughExistingAncestors(path) {
  const suffix = [];
  let cursor = resolve(path);
  while (!lstatExists(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) fail();
    suffix.unshift(basename(cursor));
    cursor = parent;
  }
  let canonical;
  try {
    canonical = realpathSync(cursor);
  } catch {
    fail();
  }
  return resolve(canonical, ...suffix);
}

function assertEndpointOutsideProjectionRoot(outputPath, packageOutputDir) {
  const canonicalRoot = resolveLocationThroughExistingAncestors(packageOutputDir);
  const canonicalOutput = join(
    resolveLocationThroughExistingAncestors(dirname(outputPath)),
    basename(outputPath)
  );
  if (canonicalOutput === canonicalRoot || canonicalOutput.startsWith(`${canonicalRoot}${sep}`)) {
    fail();
  }
}

function prepareProjectionRoot(packageOutputDir) {
  mkdirSync(packageOutputDir, { recursive: true, mode: 0o700 });
  let status;
  try {
    status = lstatSync(packageOutputDir);
  } catch {
    fail();
  }
  if (!status.isDirectory() || status.isSymbolicLink()) fail();
  chmodSync(packageOutputDir, 0o700);
  const markerPath = join(packageOutputDir, PROJECTION_ROOT_MARKER);
  if (lstatExists(markerPath)) {
    const markerStatus = lstatSync(markerPath);
    if (
      !markerStatus.isFile() ||
      markerStatus.isSymbolicLink() ||
      (markerStatus.mode & 0o777) !== 0o600 ||
      readPrivateFile(markerPath).toString('utf8') !== PROJECTION_ROOT_MARKER_CONTENT
    ) {
      fail();
    }
    return;
  }
  const temporaryMarker = join(packageOutputDir, `.${PROJECTION_ROOT_MARKER}-${randomUUID()}`);
  try {
    writePrivateFile(temporaryMarker, PROJECTION_ROOT_MARKER_CONTENT);
    renameSync(temporaryMarker, markerPath);
    syncDirectory(packageOutputDir);
  } finally {
    rmSync(temporaryMarker, { force: true });
  }
}

function atomicSwitchCurrent(packageOutputDir, releaseName) {
  if (releaseName !== basename(releaseName) || !RELEASE_NAME.test(releaseName)) fail();
  const releasePath = join(packageOutputDir, releaseName);
  validateDirectory(releasePath, PROJECTION_FILES);
  const currentPath = join(packageOutputDir, 'current');
  const temporaryLink = join(packageOutputDir, `.current-${process.pid}-${randomUUID()}`);
  try {
    symlinkSync(releaseName, temporaryLink, 'dir');
    renameSync(temporaryLink, currentPath);
    syncDirectory(packageOutputDir);
  } finally {
    rmSync(temporaryLink, { force: true });
  }
}

function validateLegacyProjection({ currentPath, envrcOutput, githubKeyOutput }) {
  validateDirectory(currentPath, PACKAGE_FILES);
  const packageProjection = validateRenderedDevPackage(currentPath);
  const metadata = packageProjection.metadata;
  const envrcBytes = readPrivateFile(envrcOutput);
  const githubBytes = readPrivateFile(githubKeyOutput);
  if (!sameBytes(githubBytes, packageProjection.githubKeyBytes)) fail();
  let envrc;
  try {
    envrc = parseDotenv(envrcBytes);
  } catch {
    fail();
  }
  if (
    String(metadata.version) !== envrc.INTEXURAOS_SECRET_PACKAGE_VERSION ||
    Object.entries(packageProjection.environment).some(([name, value]) => envrc[name] !== value)
  ) {
    fail();
  }
  return String(metadata.version);
}

function ensureEndpoint({ expectedBytes, outputPath, privateParent = false, targetPath }) {
  mkdirSync(dirname(outputPath), { recursive: true, mode: 0o700 });
  if (privateParent) chmodSync(dirname(outputPath), 0o700);
  if (lstatExists(outputPath)) {
    const status = lstatSync(outputPath);
    if (status.isSymbolicLink()) {
      if (readlinkSync(outputPath) !== targetPath) fail();
      return;
    }
    if (!status.isFile() || (status.mode & 0o777) !== 0o600) fail();
    if (expectedBytes === undefined || !sameBytes(readPrivateFile(outputPath), expectedBytes))
      fail();
  }
  const temporaryLink = join(
    dirname(outputPath),
    `.${basename(outputPath)}-${process.pid}-${randomUUID()}`
  );
  try {
    symlinkSync(targetPath, temporaryLink, 'file');
    renameSync(temporaryLink, outputPath);
    syncDirectory(dirname(outputPath));
  } finally {
    rmSync(temporaryLink, { force: true });
  }
}

function triggerFailpoint(name) {
  const selected = process.env.INTEXURAOS_SECRET_SYNC_TEST_FAILPOINT ?? '';
  if (!FAILPOINTS.has(selected)) fail();
  if (selected !== name) return;
  if (process.env.NODE_ENV !== 'test') fail();
  try {
    process.kill(process.ppid, 'SIGKILL');
  } finally {
    process.kill(process.pid, 'SIGKILL');
  }
}

export function promoteDevSecretProjection(options) {
  const {
    candidateEnvrc,
    candidatePackageDir,
    envrcOutput,
    githubKeyOutput,
    packageOutputDir,
    version,
  } = options;
  if (
    !isAbsolute(candidateEnvrc) ||
    !isAbsolute(candidatePackageDir) ||
    !isAbsolute(envrcOutput) ||
    !isAbsolute(githubKeyOutput) ||
    !isAbsolute(packageOutputDir) ||
    !NUMERIC_VERSION.test(version) ||
    envrcOutput === githubKeyOutput
  ) {
    fail();
  }
  prepareProjectionRoot(packageOutputDir);
  assertEndpointOutsideProjectionRoot(envrcOutput, packageOutputDir);
  assertEndpointOutsideProjectionRoot(githubKeyOutput, packageOutputDir);
  validateDirectory(candidatePackageDir, PACKAGE_FILES);
  readMetadata(join(candidatePackageDir, 'metadata.json'), version);

  const candidateRelease = stageProjection({
    packageOutputDir,
    sources: {
      '.envrc': candidateEnvrc,
      'environment.env': join(candidatePackageDir, 'environment.env'),
      'github-app-private-key.pem': join(candidatePackageDir, 'github-app-private-key.pem'),
      'metadata.json': join(candidatePackageDir, 'metadata.json'),
    },
    version,
  });
  triggerFailpoint('candidate-durable');

  let current = readCurrent(packageOutputDir);
  if (current !== undefined) {
    const currentNames = readdirSync(current.releasePath).sort();
    if (JSON.stringify(currentNames) === JSON.stringify([...PACKAGE_FILES].sort())) {
      const previousVersion = validateLegacyProjection({
        currentPath: current.releasePath,
        envrcOutput,
        githubKeyOutput,
      });
      const compatibilityRelease = stageProjection({
        packageOutputDir,
        sources: {
          '.envrc': envrcOutput,
          'environment.env': join(current.releasePath, 'environment.env'),
          'github-app-private-key.pem': githubKeyOutput,
          'metadata.json': join(current.releasePath, 'metadata.json'),
        },
        version: previousVersion,
      });
      atomicSwitchCurrent(packageOutputDir, compatibilityRelease);
      current = readCurrent(packageOutputDir);
      triggerFailpoint('compatibility-active');
    } else {
      const currentMetadata = readMetadata(join(current.releasePath, 'metadata.json'));
      validateCompleteProjection(current.releasePath, currentMetadata.version);
    }
  }

  const envrcTarget = join(packageOutputDir, 'current', '.envrc');
  const githubTarget = join(packageOutputDir, 'current', 'github-app-private-key.pem');
  const currentEnvrc =
    current === undefined ? undefined : readPrivateFile(join(current.releasePath, '.envrc'));
  const currentGithub =
    current === undefined
      ? undefined
      : readPrivateFile(join(current.releasePath, 'github-app-private-key.pem'));
  ensureEndpoint({ expectedBytes: currentEnvrc, outputPath: envrcOutput, targetPath: envrcTarget });
  triggerFailpoint('envrc-link-installed');
  ensureEndpoint({
    expectedBytes: currentGithub,
    outputPath: githubKeyOutput,
    privateParent: true,
    targetPath: githubTarget,
  });
  triggerFailpoint('github-link-installed');
  triggerFailpoint('before-activation');
  atomicSwitchCurrent(packageOutputDir, candidateRelease);
  triggerFailpoint('after-activation');
}

function main() {
  try {
    promoteDevSecretProjection(readArguments(process.argv.slice(2)));
  } catch {
    console.error('ERROR: DEV secret projection promotion failed');
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
