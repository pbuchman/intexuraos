#!/usr/bin/env node

import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  crc32c,
  crc32cBase64,
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
const SOURCE_MANIFEST_KEYS = ['legacySecretVersions', 'packages', 'schemaVersion'];
const SOURCE_PACKAGE_KEYS = [
  'basePackageSecretId',
  'externalEnvFiles',
  'externalFiles',
  'legacyEnvNames',
  'legacyFiles',
];
const EXTERNAL_INPUT_OPTIONS = [
  'cloudflare-dns-api-token-file',
  'firebase-api-key-file',
  'runtime-gcp-service-account-file',
];
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
const ENV_NAME_PATTERN = /^INTEXURAOS_[A-Z0-9_]+$/u;
const FILE_MEMBER_PATTERN = /^[a-z][A-Za-z0-9]+Base64$/u;
const CLI_OPTION_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*-file$/u;
const MAX_SOURCE_BYTES = 65_536;
const EXPECTED_EXTERNAL_ENV_FILES = {
  dev: { INTEXURAOS_FIREBASE_API_KEY: 'firebase-api-key-file' },
  prod: { INTEXURAOS_FIREBASE_API_KEY: 'firebase-api-key-file' },
};
const EXPECTED_EXTERNAL_FILES = {
  dev: {},
  prod: {
    cloudflareDnsApiTokenBase64: 'cloudflare-dns-api-token-file',
    runtimeGcpServiceAccountJsonBase64: 'runtime-gcp-service-account-file',
  },
};
const EXPECTED_LEGACY_FILES = {
  dev: { githubAppPrivateKeyPemBase64: 'INTEXURAOS_GITHUB_APP_PRIVATE_KEY' },
  prod: { tlsPrivateKeyPemBase64: 'INTEXURAOS_SSL_PRIVATE_KEY' },
};

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
  if (candidate.schemaVersion !== 2) {
    throw sourceManifestError('schemaVersion is unsupported');
  }

  assertPlainObject(candidate.legacySecretVersions, 'legacy versions must be an object');
  const legacyVersionNames = Object.keys(candidate.legacySecretVersions);
  assertSortedUnique(legacyVersionNames, 'legacy version names');
  const legacySecretVersions = {};
  for (const secretId of legacyVersionNames) {
    if (!ENV_NAME_PATTERN.test(secretId)) {
      throw sourceManifestError('legacy version map contains an invalid secret ID');
    }
    const version = candidate.legacySecretVersions[secretId];
    if (!Number.isSafeInteger(version) || version < 1) {
      throw sourceManifestError('legacy versions must be exact positive numeric versions');
    }
    legacySecretVersions[secretId] = version;
  }

  assertPlainObject(candidate.packages, 'packages must be an object');
  assertExactKeys(candidate.packages, ENVIRONMENTS, 'must define exactly dev and prod');
  const referencedLegacySecrets = new Set();
  const packages = {};

  for (const environment of ENVIRONMENTS) {
    const definition = candidate.packages[environment];
    const packageDefinition = manifest.packages[environment];
    assertPlainObject(definition, `${environment} definition must be an object`);
    assertExactKeys(definition, SOURCE_PACKAGE_KEYS, `${environment} definition keys are invalid`);
    if (definition.basePackageSecretId !== packageDefinition.secretId) {
      throw sourceManifestError(`${environment} base package container is invalid`);
    }

    const legacyEnvNames = readSortedNames(
      definition.legacyEnvNames,
      `${environment} legacy env names`
    );
    const externalEnvFiles = readStringMap(
      definition.externalEnvFiles,
      ENV_NAME_PATTERN,
      `${environment} external env files`
    );
    const legacyFiles = readStringMap(
      definition.legacyFiles,
      FILE_MEMBER_PATTERN,
      `${environment} legacy files`
    );
    const externalFiles = readStringMap(
      definition.externalFiles,
      FILE_MEMBER_PATTERN,
      `${environment} external files`
    );

    assertExactMap(
      externalEnvFiles,
      EXPECTED_EXTERNAL_ENV_FILES[environment],
      `${environment} external env mapping is invalid`
    );
    assertExactMap(
      legacyFiles,
      EXPECTED_LEGACY_FILES[environment],
      `${environment} legacy file mapping is invalid`
    );
    assertExactMap(
      externalFiles,
      EXPECTED_EXTERNAL_FILES[environment],
      `${environment} external file mapping is invalid`
    );

    const externalEnvNames = Object.keys(externalEnvFiles);
    const envNames = [...legacyEnvNames, ...externalEnvNames].sort();
    if (!sameItems(envNames, packageDefinition.envNames)) {
      throw sourceManifestError(`${environment} env source coverage does not match the package`);
    }
    if (legacyEnvNames.some((name) => externalEnvNames.includes(name))) {
      throw sourceManifestError(`${environment} env source classifications overlap`);
    }

    const legacyFileNames = Object.keys(legacyFiles);
    const externalFileNames = Object.keys(externalFiles);
    const fileNames = [...legacyFileNames, ...externalFileNames].sort();
    if (!sameItems(fileNames, packageDefinition.files)) {
      throw sourceManifestError(`${environment} file source coverage does not match the package`);
    }
    if (legacyFileNames.some((name) => externalFileNames.includes(name))) {
      throw sourceManifestError(`${environment} file source classifications overlap`);
    }

    for (const envName of legacyEnvNames) {
      if (!Object.hasOwn(legacySecretVersions, envName)) {
        throw sourceManifestError(`${environment} legacy env source has no numeric version`);
      }
      referencedLegacySecrets.add(envName);
    }
    for (const secretId of Object.values(legacyFiles)) {
      if (!ENV_NAME_PATTERN.test(secretId) || !Object.hasOwn(legacySecretVersions, secretId)) {
        throw sourceManifestError(`${environment} legacy file source has no numeric version`);
      }
      referencedLegacySecrets.add(secretId);
    }

    const externalOptions = [...Object.values(externalEnvFiles), ...Object.values(externalFiles)];
    if (
      new Set(externalOptions).size !== externalOptions.length ||
      externalOptions.some(
        (option) => !CLI_OPTION_PATTERN.test(option) || !EXTERNAL_INPUT_OPTIONS.includes(option)
      )
    ) {
      throw sourceManifestError(`${environment} external input options are invalid`);
    }

    packages[environment] = {
      basePackageSecretId: definition.basePackageSecretId,
      legacyEnvNames,
      externalEnvFiles,
      legacyFiles,
      externalFiles,
    };
  }

  if (!sameItems([...referencedLegacySecrets].sort(), legacyVersionNames)) {
    throw sourceManifestError('legacy version map has missing or unused sources');
  }

  return { schemaVersion: 2, legacySecretVersions, packages };
}

/**
 * Build one complete package payload either from exact legacy sources or from
 * one exact base-package version plus explicit member overrides.
 *
 * @param {{
 *   adapter: { accessVersion: Function },
 *   baseVersion?: number | string,
 *   environment: 'dev' | 'prod',
 *   externalInputs?: Record<string, Buffer | Uint8Array>,
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
  if (typeof options?.adapter?.accessVersion !== 'function') {
    throw new Error('Secret package candidate access adapter is unavailable');
  }

  const sourceDefinition = sources.packages[environment];
  const packageDefinition = manifest.packages[environment];
  if (options?.baseVersion !== undefined) {
    if (options.externalInputs !== undefined) {
      throw new Error('Secret package candidate cannot mix base-package and legacy inputs');
    }
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
      legacySourceCount: 0,
      externalSourceCount: 0,
      overrideEnvCount: Object.keys(overrides.env).length,
      overrideFileCount: Object.keys(overrides.files).length,
    };
  }
  if (options?.overrides !== undefined) {
    throw new Error('Secret package candidate overrides require an exact base version');
  }
  const externalInputs = validateExternalInputs(options?.externalInputs, sourceDefinition);
  const legacyCache = new Map();
  const readLegacy = async (secretId) => {
    if (legacyCache.has(secretId)) return legacyCache.get(secretId);
    const data = await accessLegacyVersion({
      adapter: options.adapter,
      projectId,
      secretId,
      version: sources.legacySecretVersions[secretId],
    });
    legacyCache.set(secretId, data);
    return data;
  };

  const env = {};
  for (const name of packageDefinition.envNames) {
    if (Object.hasOwn(sourceDefinition.externalEnvFiles, name)) {
      env[name] = decodeEnvUtf8(
        externalInputs[sourceDefinition.externalEnvFiles[name]],
        'external env input'
      );
    } else {
      env[name] = decodeEnvUtf8(await readLegacy(name), 'legacy env source');
    }
  }

  const files = {};
  for (const name of packageDefinition.files) {
    const data = Object.hasOwn(sourceDefinition.externalFiles, name)
      ? externalInputs[sourceDefinition.externalFiles[name]]
      : await readLegacy(sourceDefinition.legacyFiles[name]);
    files[name] = data.toString('base64');
  }

  const payload = { schemaVersion: 1, environment, env, files };
  const metadata = validateSecretPackagePayload({ environment, manifest, payload });
  return {
    payload,
    metadata,
    sourceMode: 'legacy',
    legacySourceCount: legacyCache.size,
    externalSourceCount: Object.keys(externalInputs).length,
  };
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
      'Usage: build-secret-package.mjs --environment dev|prod --project-id ID --output FILE (--firebase-api-key-file FILE [...] | --base-version N (--override-env NAME=FILE | --override-file NAME=FILE) [...])'
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
  const externalOptionNames = requiredExternalOptionNames(sources.packages[environment]);
  const suppliedExternalOptionNames = EXTERNAL_INPUT_OPTIONS.filter(
    (name) => cliOptions[name] !== undefined
  );
  const adapter = dependencies.adapter ?? createGcloudSecretManagerAdapter();
  const baseMode = cliOptions['base-version'] !== undefined;
  let result;
  if (baseMode) {
    if (suppliedExternalOptionNames.length > 0) {
      throw new Error('Secret package candidate cannot mix base-package and legacy inputs');
    }
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
  } else {
    if (
      (cliOptions['override-env']?.length ?? 0) > 0 ||
      (cliOptions['override-file']?.length ?? 0) > 0
    ) {
      throw new Error('Secret package candidate overrides require an exact base version');
    }
    if (!sameItems([...suppliedExternalOptionNames].sort(), externalOptionNames)) {
      throw new Error('Secret package candidate requires the exact external input file set');
    }
    const externalInputs = Object.fromEntries(
      externalOptionNames.map((name) => [name, readPrivateInput(cliOptions[name])])
    );
    result = await buildSecretPackageCandidate({
      adapter,
      environment,
      externalInputs,
      manifest,
      projectId: cliOptions['project-id'],
      sources,
    });
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
      legacySourceCount: result.legacySourceCount,
      externalSourceCount: result.externalSourceCount,
      ...(result.sourceMode === 'base-package'
        ? {
            baseVersion: result.baseVersion,
            overrideEnvCount: result.overrideEnvCount,
            overrideFileCount: result.overrideFileCount,
          }
        : {}),
    })
  );
  return 0;
}

function parseArguments(argv) {
  const allowedOptions = new Set([
    ...COMMON_CLI_OPTIONS,
    ...EXTERNAL_INPUT_OPTIONS,
    ...REPEATABLE_CLI_OPTIONS,
  ]);
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

async function accessLegacyVersion({ adapter, projectId, secretId, version }) {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error('Secret package candidate legacy version is not numeric');
  }
  let response;
  try {
    response = await adapter.accessVersion({
      projectId,
      secretId,
      version: String(version),
    });
  } catch {
    throw new Error(`Secret package candidate could not read legacy source ${secretId}`);
  }
  if (!isPlainObject(response)) {
    throw new Error(`Secret package candidate legacy source response is invalid for ${secretId}`);
  }
  const data = toBuffer(response.data);
  if (data.byteLength === 0 || data.byteLength > MAX_SOURCE_BYTES) {
    throw new Error(`Secret package candidate legacy source size is invalid for ${secretId}`);
  }
  if (!checksumMatches(response.dataCrc32c, data)) {
    throw new Error(`Secret package candidate legacy source CRC32C failed for ${secretId}`);
  }
  return data;
}

function checksumMatches(expected, data) {
  if (typeof expected === 'bigint') return expected === BigInt(crc32c(data));
  if (typeof expected === 'number' && Number.isSafeInteger(expected)) {
    return expected === crc32c(data);
  }
  if (typeof expected === 'string') return expected === crc32cBase64(data);
  return false;
}

function validateExternalInputs(candidate, sourceDefinition) {
  assertPlainObjectCandidate(candidate, 'external inputs must be an object');
  const expectedNames = requiredExternalOptionNames(sourceDefinition);
  const actualNames = Object.keys(candidate).sort();
  if (!sameItems(actualNames, expectedNames)) {
    throw new Error('Secret package candidate is missing a required external input');
  }
  return Object.fromEntries(
    expectedNames.map((name) => {
      const data = toBuffer(candidate[name]);
      if (data.byteLength === 0 || data.byteLength > MAX_SOURCE_BYTES) {
        throw new Error('Secret package candidate external input size is invalid');
      }
      return [name, data];
    })
  );
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

function requiredExternalOptionNames(sourceDefinition) {
  return [
    ...Object.values(sourceDefinition.externalEnvFiles),
    ...Object.values(sourceDefinition.externalFiles),
  ].sort();
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
    // The legacy shell loaders used command substitution, which removes every
    // trailing line ending produced by `gcloud secrets versions access` while
    // preserving the actual value. Keep that runtime behavior during package
    // consolidation, but leave embedded line breaks for the payload validator
    // to reject as malformed env material.
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

function readSortedNames(candidate, label) {
  if (
    !Array.isArray(candidate) ||
    candidate.some((name) => typeof name !== 'string' || !ENV_NAME_PATTERN.test(name))
  ) {
    throw sourceManifestError(`${label} are invalid`);
  }
  assertSortedUnique(candidate, label);
  return [...candidate];
}

function readStringMap(candidate, keyPattern, label) {
  assertPlainObject(candidate, `${label} must be an object`);
  const keys = Object.keys(candidate);
  assertSortedUnique(keys, `${label} keys`);
  const entries = keys.map((key) => {
    const value = candidate[key];
    if (!keyPattern.test(key) || typeof value !== 'string') {
      throw sourceManifestError(`${label} contains an invalid mapping`);
    }
    return [key, value];
  });
  return Object.fromEntries(entries);
}

function assertExactMap(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw sourceManifestError(message);
  }
}

function assertSortedUnique(values, label) {
  if (new Set(values).size !== values.length || !sameItems(values, [...values].sort())) {
    throw sourceManifestError(`${label} must be sorted and unique`);
  }
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
