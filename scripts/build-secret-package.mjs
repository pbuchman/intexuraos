#!/usr/bin/env node

import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createGcloudSecretManagerAdapter,
  fetchSecretPackage,
  loadSecretPackageManifest,
  parseSecretPackageJson,
  validateSecretPackageManifest,
  validateSecretPackagePayload,
  writeSecretPackagePayload,
} from './lib/secret-package.mjs';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SOURCES_PATH = resolve(
  MODULE_DIRECTORY,
  '..',
  'config',
  'environments',
  'secret-package-sources.json'
);
const ENVIRONMENTS = ['dev', 'prod'];
const ENVIRONMENT_SET = new Set(ENVIRONMENTS);
const SOURCE_MANIFEST_KEYS = ['packages', 'schemaVersion'];
const SOURCE_PACKAGE_KEYS = ['basePackageSecretId'];
const COMMON_CLI_OPTIONS = [
  'base-version',
  'environment',
  'manifest',
  'output',
  'project-id',
  'sources-manifest',
];
const REPEATABLE_CLI_OPTIONS = ['override-env', 'override-file'];
const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u;
const MAX_SOURCE_BYTES = 65_536;

/**
 * Load and validate the tracked, non-secret candidate-source manifest.
 *
 * @param {{
 *   manifest?: ReturnType<typeof validateSecretPackageManifest>,
 *   sourcesPath?: string,
 * }} [options]
 */
export function loadSecretPackageSources(options = {}) {
  const manifest = options.manifest
    ? validateSecretPackageManifest(options.manifest)
    : loadSecretPackageManifest();
  const sourcesPath = options.sourcesPath ?? DEFAULT_SOURCES_PATH;
  let source;
  try {
    source = readFileSync(sourcesPath);
  } catch {
    throw sourceManifestError('file is unavailable');
  }
  const candidate = parseSecretPackageJson(source, 'source manifest');
  return validateSecretPackageSources(candidate, manifest);
}

/**
 * Validate exact source coverage against the package manifest.
 *
 * @param {unknown} candidate
 * @param {ReturnType<typeof validateSecretPackageManifest>} manifestCandidate
 */
export function validateSecretPackageSources(candidate, manifestCandidate) {
  const manifest = validateSecretPackageManifest(manifestCandidate);
  assertPlainObject(candidate, 'must be an object');
  assertExactKeys(candidate, SOURCE_MANIFEST_KEYS, 'has invalid top-level keys');
  if (candidate.schemaVersion !== 3) {
    throw sourceManifestError('schemaVersion is unsupported');
  }

  assertPlainObject(candidate.packages, 'packages must be an object');
  assertExactKeys(candidate.packages, ENVIRONMENTS, 'must define exactly dev and prod');
  const packages = {};

  for (const environment of ENVIRONMENTS) {
    const definition = candidate.packages[environment];
    const packageDefinition = manifest.packages[environment];
    assertPlainObject(definition, `${environment} definition must be an object`);
    assertExactKeys(definition, SOURCE_PACKAGE_KEYS, `${environment} definition keys are invalid`);
    if (definition.basePackageSecretId !== packageDefinition.secretId) {
      throw sourceManifestError(`${environment} base package container is invalid`);
    }

    packages[environment] = {
      basePackageSecretId: definition.basePackageSecretId,
    };
  }

  return { schemaVersion: 3, packages };
}

/**
 * Build one complete package payload from one exact base-package version plus
 * explicit member overrides, or from one complete explicit member set.
 *
 * @param {{
 *   adapter?: { accessVersion: Function },
 *   baseVersion?: number | string,
 *   environment: 'dev' | 'prod',
 *   manifest?: ReturnType<typeof validateSecretPackageManifest>,
 *   overrides?: {
 *     env?: Record<string, Buffer | Uint8Array>,
 *     files?: Record<string, Buffer | Uint8Array>,
 *   },
 *   projectId: string,
 *   sources?: ReturnType<typeof validateSecretPackageSources>,
 * }} options
 */
export async function buildSecretPackageCandidate(options) {
  const environment = readEnvironment(options?.environment);
  const manifest = options?.manifest
    ? validateSecretPackageManifest(options.manifest)
    : loadSecretPackageManifest();
  const sources = options?.sources
    ? validateSecretPackageSources(options.sources, manifest)
    : loadSecretPackageSources({ manifest });
  const projectId = readProjectId(options?.projectId);

  const packageDefinition = manifest.packages[environment];
  if (options?.baseVersion !== undefined) {
    requireAccessAdapter(options?.adapter);
    const baseVersion = readExactNumericVersion(options.baseVersion);
    const overrides = validateOverrides(options.overrides, packageDefinition);
    const basePackage = await fetchSecretPackage({
      adapter: options.adapter,
      environment,
      manifest,
      projectId,
      version: baseVersion,
    });
    const env = Object.fromEntries(
      packageDefinition.envNames.map((name) => [name, basePackage.payload.env[name]])
    );
    const files = Object.fromEntries(
      packageDefinition.files.map((name) => [name, basePackage.payload.files[name]])
    );
    for (const [name, data] of Object.entries(overrides.env)) {
      env[name] = decodeEnvUtf8(data, 'env override');
    }
    for (const [name, data] of Object.entries(overrides.files)) {
      files[name] = data.toString('base64');
    }
    const payload = { schemaVersion: 1, environment, env, files };
    const metadata = validateSecretPackagePayload({ environment, manifest, payload });
    return {
      payload,
      metadata,
      sourceMode: 'base-package',
      baseVersion,
      overrideEnvCount: Object.keys(overrides.env).length,
      overrideFileCount: Object.keys(overrides.files).length,
    };
  }
  if (options?.overrides !== undefined) {
    const overrides = validateFullExplicitOverrides(options.overrides, packageDefinition);
    const env = Object.fromEntries(
      packageDefinition.envNames.map((name) => [
        name,
        decodeEnvUtf8(overrides.env[name], 'env override'),
      ])
    );
    const files = Object.fromEntries(
      packageDefinition.files.map((name) => [name, overrides.files[name].toString('base64')])
    );
    const payload = { schemaVersion: 1, environment, env, files };
    const metadata = validateSecretPackagePayload({ environment, manifest, payload });
    return {
      payload,
      metadata,
      sourceMode: 'full-explicit',
      overrideEnvCount: Object.keys(overrides.env).length,
      overrideFileCount: Object.keys(overrides.files).length,
    };
  }
  throw new Error(
    'Secret package candidate requires --base-version or the complete explicit member set'
  );
}

/**
 * Run the dependency-injectable candidate-builder CLI.
 *
 * @param {string[]} argv
 * @param {{
 *   adapter?: { accessVersion: Function },
 *   manifest?: ReturnType<typeof validateSecretPackageManifest>,
 *   sources?: ReturnType<typeof validateSecretPackageSources>,
 *   stdout?: (line: string) => void,
 * }} [dependencies]
 */
export async function runBuildSecretPackageCli(argv, dependencies = {}) {
  const stdout = dependencies.stdout ?? ((line) => process.stdout.write(`${line}\n`));
  if (argv.length === 1 && argv[0] === '--help') {
    stdout(
      'Usage: build-secret-package.mjs --environment dev|prod --project-id ID --output FILE (--base-version N with optional --override-env/--override-file entries, or the complete explicit --override-env/--override-file member set)'
    );
    return 0;
  }

  const cliOptions = parseArguments(argv);
  const manifest = dependencies.manifest
    ? validateSecretPackageManifest(dependencies.manifest)
    : loadSecretPackageManifest(
        cliOptions.manifest === undefined ? {} : { manifestPath: cliOptions.manifest }
      );
  const sources = dependencies.sources
    ? validateSecretPackageSources(dependencies.sources, manifest)
    : loadSecretPackageSources({
        manifest,
        ...(cliOptions['sources-manifest'] === undefined
          ? {}
          : { sourcesPath: cliOptions['sources-manifest'] }),
      });
  const environment = readEnvironment(cliOptions.environment);
  const packageDefinition = manifest.packages[environment];
  const baseMode = cliOptions['base-version'] !== undefined;
  const overrideMode =
    (cliOptions['override-env']?.length ?? 0) > 0 || (cliOptions['override-file']?.length ?? 0) > 0;
  const adapter = dependencies.adapter ?? createGcloudSecretManagerAdapter();
  let result;
  if (baseMode) {
    const overrides = {
      env: readCliOverrides(cliOptions['override-env'], packageDefinition.envNames, 'env'),
      files: readCliOverrides(cliOptions['override-file'], packageDefinition.files, 'file'),
    };
    result = await buildSecretPackageCandidate({
      adapter,
      baseVersion: cliOptions['base-version'],
      environment,
      manifest,
      overrides,
      projectId: cliOptions['project-id'],
      sources,
    });
  } else if (overrideMode) {
    const overrides = {
      env: readCliOverrides(cliOptions['override-env'], packageDefinition.envNames, 'env'),
      files: readCliOverrides(cliOptions['override-file'], packageDefinition.files, 'file'),
    };
    result = await buildSecretPackageCandidate({
      environment,
      manifest,
      overrides,
      projectId: cliOptions['project-id'],
      sources,
    });
  } else {
    throw new Error(
      'Secret package candidate requires --base-version or the complete explicit member set'
    );
  }
  const output = resolve(cliOptions.output);
  writeSecretPackagePayload(output, result.payload, packageDefinition);
  stdout(
    JSON.stringify({
      valid: true,
      environment,
      output,
      byteLength: result.metadata.byteLength,
      crc32c: result.metadata.crc32c,
      sourceMode: result.sourceMode,
      ...(['base-package', 'full-explicit'].includes(result.sourceMode)
        ? {
            ...(result.baseVersion === undefined ? {} : { baseVersion: result.baseVersion }),
            overrideEnvCount: result.overrideEnvCount,
            overrideFileCount: result.overrideFileCount,
          }
        : {}),
    })
  );
  return 0;
}

function parseArguments(argv) {
  const allowedOptions = new Set([...COMMON_CLI_OPTIONS, ...REPEATABLE_CLI_OPTIONS]);
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const token = argv[index];
    const value = argv[index + 1];
    if (
      typeof token !== 'string' ||
      !token.startsWith('--') ||
      typeof value !== 'string' ||
      value.length === 0 ||
      value.startsWith('--')
    ) {
      throw new Error('Secret package candidate command options are invalid');
    }
    const name = token.slice(2);
    if (!allowedOptions.has(name)) {
      throw new Error('Secret package candidate command contains an unknown or duplicate option');
    }
    if (REPEATABLE_CLI_OPTIONS.includes(name)) {
      options[name] ??= [];
      options[name].push(value);
    } else {
      if (Object.hasOwn(options, name)) {
        throw new Error('Secret package candidate command contains an unknown or duplicate option');
      }
      options[name] = value;
    }
  }
  for (const required of ['environment', 'output', 'project-id']) {
    if (!Object.hasOwn(options, required)) {
      throw new Error('Secret package candidate command is missing a required option');
    }
  }
  return options;
}

function validateOverrides(candidate, packageDefinition) {
  assertPlainObjectCandidate(candidate, 'overrides must be an object');
  if (
    !sameItems(
      Object.keys(candidate).sort(),
      Object.keys(candidate)
        .filter((key) => ['env', 'files'].includes(key))
        .sort()
    )
  ) {
    throw new Error('Secret package candidate override definition has unknown keys');
  }
  const env = validateOverrideBytes(candidate.env ?? {}, packageDefinition.envNames, 'env');
  const files = validateOverrideBytes(candidate.files ?? {}, packageDefinition.files, 'file');
  if (Object.keys(env).length + Object.keys(files).length === 0) {
    throw new Error('Secret package candidate requires at least one explicit override');
  }
  return { env, files };
}

function validateFullExplicitOverrides(candidate, packageDefinition) {
  const overrides = validateOverrides(candidate, packageDefinition);
  if (!sameItems(Object.keys(overrides.env), packageDefinition.envNames)) {
    throw new Error('Secret package candidate explicit build requires the exact env member set');
  }
  if (!sameItems(Object.keys(overrides.files), packageDefinition.files)) {
    throw new Error('Secret package candidate explicit build requires the exact file member set');
  }
  return overrides;
}

function requireAccessAdapter(adapter) {
  if (typeof adapter?.accessVersion !== 'function') {
    throw new Error('Secret package candidate access adapter is unavailable');
  }
}

function validateOverrideBytes(candidate, allowedNames, kind) {
  assertPlainObjectCandidate(candidate, `${kind} overrides must be an object`);
  const result = {};
  for (const name of Object.keys(candidate).sort()) {
    if (!allowedNames.includes(name)) {
      throw new Error(`Secret package candidate has an unknown ${kind} override`);
    }
    const data = toBuffer(candidate[name]);
    if (data.byteLength === 0 || data.byteLength > MAX_SOURCE_BYTES) {
      throw new Error(`Secret package candidate ${kind} override size is invalid`);
    }
    result[name] = data;
  }
  return result;
}

function readCliOverrides(specifications, allowedNames, kind) {
  const paths = {};
  for (const specification of specifications ?? []) {
    const separator = specification.indexOf('=');
    if (separator < 1 || separator === specification.length - 1) {
      throw new Error(`Secret package candidate ${kind} override must use NAME=FILE`);
    }
    const name = specification.slice(0, separator);
    const path = specification.slice(separator + 1);
    if (!allowedNames.includes(name)) {
      throw new Error(`Secret package candidate has an unknown ${kind} override`);
    }
    if (Object.hasOwn(paths, name)) {
      throw new Error(`Secret package candidate has a duplicate override for a ${kind} member`);
    }
    paths[name] = path;
  }
  return Object.fromEntries(
    Object.keys(paths)
      .sort()
      .map((name) => [name, readPrivateInput(paths[name])])
  );
}

function readPrivateInput(path) {
  if (typeof path !== 'string' || path.length === 0 || path.includes('\0')) {
    throw new Error('Secret package candidate input must be a private regular file');
  }
  const resolvedPath = resolve(path);
  let descriptor;
  try {
    const linkStatus = lstatSync(resolvedPath);
    if (linkStatus.isSymbolicLink() || !linkStatus.isFile() || (linkStatus.mode & 0o077) !== 0) {
      throw new Error('invalid input');
    }
    const noFollow = constants.O_NOFOLLOW ?? 0;
    descriptor = openSync(resolvedPath, constants.O_RDONLY | noFollow);
    const status = fstatSync(descriptor);
    if (
      !status.isFile() ||
      (status.mode & 0o077) !== 0 ||
      status.size < 1 ||
      status.size > MAX_SOURCE_BYTES
    ) {
      throw new Error('invalid input');
    }
    const data = readFileSync(descriptor);
    if (data.byteLength < 1 || data.byteLength > MAX_SOURCE_BYTES) {
      throw new Error('invalid input');
    }
    return data;
  } catch {
    throw new Error('Secret package candidate input must be a private regular file');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function decodeEnvUtf8(data, label) {
  try {
    // Env members are single-line strings; explicit trailing line endings from
    // private input files are not part of the runtime value.
    const value = new TextDecoder('utf-8', { fatal: true }).decode(data).replace(/[\r\n]+$/u, '');
    if (value.length === 0) throw new Error('empty');
    return value;
  } catch {
    throw new Error(`Secret package candidate ${label} is not valid non-empty UTF-8`);
  }
}

function readEnvironment(environment) {
  if (typeof environment !== 'string' || !ENVIRONMENT_SET.has(environment)) {
    throw new Error('Secret package candidate environment must be dev or prod');
  }
  return environment;
}

function readProjectId(projectId) {
  if (typeof projectId !== 'string' || !PROJECT_ID_PATTERN.test(projectId)) {
    throw new Error('Secret package candidate GCP project ID is invalid');
  }
  return projectId;
}

function readExactNumericVersion(version) {
  const value = typeof version === 'number' ? String(version) : version;
  if (
    typeof value !== 'string' ||
    !/^[1-9]\d*$/u.test(value) ||
    !Number.isSafeInteger(Number(value))
  ) {
    throw new Error('Secret package candidate base must use an exact positive numeric version');
  }
  return value;
}

function assertExactKeys(candidate, expected, message) {
  if (!sameItems(Object.keys(candidate).sort(), [...expected].sort())) {
    throw sourceManifestError(message);
  }
}

function assertPlainObject(candidate, message) {
  if (!isPlainObject(candidate)) throw sourceManifestError(message);
}

function assertPlainObjectCandidate(candidate, message) {
  if (!isPlainObject(candidate)) throw new Error(`Secret package candidate ${message}`);
}

function isPlainObject(candidate) {
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) return false;
  const prototype = Object.getPrototypeOf(candidate);
  return prototype === null || prototype === Object.prototype;
}

function toBuffer(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new Error('Secret package candidate source must contain bytes');
}

function sameItems(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sourceManifestError(message) {
  return new Error(`Secret package source manifest ${message}`);
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runBuildSecretPackageCli(process.argv.slice(2)).catch((error) => {
    const message =
      error instanceof Error ? error.message : 'Secret package candidate build failed';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
