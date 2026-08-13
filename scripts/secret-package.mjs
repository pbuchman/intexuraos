#!/usr/bin/env node

import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createGcloudSecretManagerAdapter,
  dualCompareSecretPackages,
  fetchSecretPackage,
  loadSecretPackageManifest,
  parseSecretPackageJson,
  publishSecretPackage,
  renderSecretPackage,
  validateSecretPackagePayload,
  writeSecretPackagePayload,
} from './lib/secret-package.mjs';

const COMMAND_OPTIONS = {
  'dual-compare': ['environment', 'hmac-key-file', 'left-payload-file', 'right-payload-file'],
  fetch: ['environment', 'output', 'project-id', 'version'],
  publish: ['environment', 'payload-file', 'project-id'],
  render: ['environment', 'output-dir', 'payload-file', 'project-id', 'version'],
  validate: ['environment', 'payload-file'],
};
const REQUIRED_OPTIONS = {
  'dual-compare': ['environment', 'hmac-key-file', 'left-payload-file', 'right-payload-file'],
  fetch: ['environment', 'output', 'project-id', 'version'],
  publish: ['environment', 'payload-file', 'project-id'],
  render: ['environment', 'output-dir', 'project-id', 'version'],
  validate: ['environment', 'payload-file'],
};
const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u;

/**
 * Run the secret-package CLI with injectable I/O and Secret Manager access.
 *
 * @param {string[]} argv
 * @param {{
 *   adapter?: { accessVersion?: Function, addVersion?: Function },
 *   manifest?: ReturnType<typeof loadSecretPackageManifest>,
 *   stdout?: (line: string) => void,
 * }} [dependencies]
 */
export async function runSecretPackageCli(argv, dependencies = {}) {
  const { command, options } = parseArguments(argv);
  const manifest = dependencies.manifest ?? loadSecretPackageManifest();
  const stdout = dependencies.stdout ?? ((line) => process.stdout.write(`${line}\n`));
  const environment = options.environment;

  if (command === 'validate') {
    const payload = readPayloadFile(options['payload-file']);
    const metadata = validateSecretPackagePayload({ environment, manifest, payload });
    stdout(JSON.stringify({ command, ...metadata }));
    return 0;
  }

  if (command === 'dual-compare') {
    const left = readPayloadFile(options['left-payload-file']);
    const right = readPayloadFile(options['right-payload-file']);
    const hmacKey = readPrivateFile(options['hmac-key-file'], 'HMAC key file');
    stdout(dualCompareSecretPackages({ environment, hmacKey, left, manifest, right }));
    return 0;
  }

  const projectId = options['project-id'];
  if (typeof projectId !== 'string' || !PROJECT_ID_PATTERN.test(projectId)) {
    throw new Error('Secret package GCP project ID is invalid');
  }
  const adapter = dependencies.adapter ?? createGcloudSecretManagerAdapter();

  if (command === 'publish') {
    const payload = readPayloadFile(options['payload-file']);
    const result = await publishSecretPackage({
      adapter,
      environment,
      manifest,
      payload,
      projectId,
    });
    stdout(JSON.stringify({ command, ...result }));
    return 0;
  }

  if (command === 'fetch') {
    const result = await fetchSecretPackage({
      adapter,
      environment,
      manifest,
      projectId,
      version: options.version,
    });
    writeSecretPackagePayload(
      options.output,
      result.payload,
      manifest.packages[result.environment]
    );
    stdout(
      JSON.stringify({
        command,
        environment: result.environment,
        version: result.version,
        crc32c: result.crc32c,
        byteLength: result.metadata.byteLength,
      })
    );
    return 0;
  }

  let payload;
  if (options['payload-file'] !== undefined) {
    payload = readPayloadFile(options['payload-file']);
  } else {
    const fetched = await fetchSecretPackage({
      adapter,
      environment,
      manifest,
      projectId,
      version: options.version,
    });
    payload = fetched.payload;
  }
  const rendered = renderSecretPackage({
    environment,
    manifest,
    outputDir: options['output-dir'],
    payload,
    version: options.version,
  });
  stdout(
    JSON.stringify({
      command,
      environment: rendered.environment,
      version: rendered.version,
      releaseName: rendered.releaseName,
      crc32c: rendered.metadata.crc32c,
      byteLength: rendered.metadata.byteLength,
    })
  );
  return 0;
}

function parseArguments(argv) {
  if (!Array.isArray(argv) || argv.length === 0) {
    throw new Error('Secret package command is required');
  }
  const [command, ...tokens] = argv;
  if (!Object.hasOwn(COMMAND_OPTIONS, command)) {
    throw new Error('Secret package command is unsupported');
  }

  const allowed = new Set(COMMAND_OPTIONS[command]);
  const options = {};
  for (let index = 0; index < tokens.length; index += 2) {
    const token = tokens[index];
    const value = tokens[index + 1];
    if (
      typeof token !== 'string' ||
      !token.startsWith('--') ||
      typeof value !== 'string' ||
      value.startsWith('--')
    ) {
      throw new Error('Secret package command options are invalid');
    }
    const name = token.slice(2);
    if (!allowed.has(name) || Object.hasOwn(options, name)) {
      throw new Error('Secret package command contains an unknown or duplicate option');
    }
    options[name] = value;
  }
  for (const required of REQUIRED_OPTIONS[command]) {
    if (!Object.hasOwn(options, required)) {
      throw new Error('Secret package command is missing a required option');
    }
  }
  return { command, options };
}

function readPayloadFile(path) {
  return parseSecretPackageJson(readPrivateFile(path, 'payload file'), 'payload');
}

function readPrivateFile(path, label) {
  if (typeof path !== 'string' || path.length === 0 || path.includes('\0')) {
    throw new Error(`Secret package ${label} path is invalid`);
  }
  const absolutePath = resolve(path);
  let status;
  try {
    status = lstatSync(absolutePath);
  } catch {
    throw new Error(`Secret package ${label} is unavailable`);
  }
  assertPrivateInputStatus(status, label);

  let descriptor;
  try {
    descriptor = openSync(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw new Error(`Secret package ${label} is unavailable`);
  }
  try {
    assertPrivateInputStatus(fstatSync(descriptor), label);
    return readFileSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function assertPrivateInputStatus(status, label) {
  if (!status.isFile() || status.isSymbolicLink()) {
    throw new Error(`Secret package ${label} must be a regular non-symlink file`);
  }
  if ((status.mode & 0o177) !== 0) {
    throw new Error(`Secret package ${label} permissions must be mode 0600 or more restrictive`);
  }
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runSecretPackageCli(process.argv.slice(2)).catch((error) => {
    const message = error instanceof Error ? error.message : 'Secret package command failed';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
