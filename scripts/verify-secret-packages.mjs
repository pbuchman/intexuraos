#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSecretPackageSources } from './build-secret-package.mjs';
import { loadSecretPackageManifest } from './lib/secret-package.mjs';

const DEFAULT_RECOVERY_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'config',
  'environments',
  'secret-package-recovery.json'
);
const OWNER_PATTERN = /^@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u;
const RECOVERY_SOURCE_PATTERN = /^[a-z][a-z0-9-]{2,63}$/u;
const RECOVERY_METHODS = new Set([
  'authoritative-metadata',
  'coordinated-rotation',
  'offline-escrow',
  'provider-regeneration',
]);

/** Validate both tracked manifests and return names/counts only. */
export function verifySecretPackages(options = {}) {
  const manifest = loadSecretPackageManifest(
    options.manifestPath === undefined ? {} : { manifestPath: options.manifestPath }
  );
  const sources = loadSecretPackageSources({
    manifest,
    ...(options.sourcesPath === undefined ? {} : { sourcesPath: options.sourcesPath }),
  });
  const recovery = loadRecoveryInventory(options.recoveryPath ?? DEFAULT_RECOVERY_PATH, manifest);
  return {
    valid: true,
    schemaVersion: manifest.schemaVersion,
    nativeSecretNames: manifest.nativeSecretNames,
    packages: Object.fromEntries(
      Object.entries(manifest.packages).map(([environment, definition]) => [
        environment,
        {
          secretId: definition.secretId,
          stableVersion: definition.stableVersion,
          envCount: definition.envNames.length,
          files: definition.files,
        },
      ])
    ),
    sourceManifest: {
      schemaVersion: sources.schemaVersion,
      legacySecretVersionCount: Object.keys(sources.legacySecretVersions).length,
      packages: Object.fromEntries(
        Object.entries(sources.packages).map(([environment, definition]) => [
          environment,
          {
            basePackageSecretId: definition.basePackageSecretId,
            legacyEnvCount: definition.legacyEnvNames.length,
            externalEnvFileCount: Object.keys(definition.externalEnvFiles).length,
            legacyFileCount: Object.keys(definition.legacyFiles).length,
            externalFileCount: Object.keys(definition.externalFiles).length,
          },
        ])
      ),
    },
    recoveryInventory: recovery,
  };
}

function loadRecoveryInventory(path, manifest) {
  let candidate;
  try {
    candidate = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('Secret package recovery inventory is unavailable or invalid');
  }
  if (
    !isPlainObject(candidate) ||
    !sameKeys(candidate, ['packages', 'recoveryCoordinator', 'schemaVersion', 'sources'])
  ) {
    throw new Error('Secret package recovery inventory has invalid top-level keys');
  }
  if (candidate.schemaVersion !== 2 || !OWNER_PATTERN.test(candidate.recoveryCoordinator)) {
    throw new Error('Secret package recovery inventory metadata is invalid');
  }
  if (!isPlainObject(candidate.packages) || !sameKeys(candidate.packages, ['dev', 'prod'])) {
    throw new Error('Secret package recovery inventory must define exactly dev and prod');
  }

  const sources = readRecoverySources(candidate.sources);
  const usedSources = new Set();
  const packages = {};
  for (const environment of ['dev', 'prod']) {
    const inventory = candidate.packages[environment];
    const definition = manifest.packages[environment];
    if (
      !isPlainObject(inventory) ||
      !sameKeys(inventory, ['envOwners', 'envSources', 'fileOwners', 'fileSources'])
    ) {
      throw new Error(`Secret package recovery inventory ${environment} keys are invalid`);
    }
    const envOwners = readOwners(inventory.envOwners, definition.envNames, 'env', environment);
    const fileOwners = readOwners(inventory.fileOwners, definition.files, 'file', environment);
    const envSources = readMemberSources(
      inventory.envSources,
      definition.envNames,
      'env',
      environment,
      sources,
      usedSources
    );
    const fileSources = readMemberSources(
      inventory.fileSources,
      definition.files,
      'file',
      environment,
      sources,
      usedSources
    );
    packages[environment] = {
      envOwnerCount: Object.keys(envOwners).length,
      envSourceCount: Object.keys(envSources).length,
      fileOwnerCount: Object.keys(fileOwners).length,
      fileSourceCount: Object.keys(fileSources).length,
      owners: [...new Set([...Object.values(envOwners), ...Object.values(fileOwners)])].sort(),
    };
  }
  const unusedSources = Object.keys(sources).filter((source) => !usedSources.has(source));
  if (unusedSources.length > 0) {
    throw new Error('Secret package recovery inventory contains an unused source');
  }
  const recoveryMethodCounts = {};
  for (const source of Object.values(sources)) {
    recoveryMethodCounts[source.method] = (recoveryMethodCounts[source.method] ?? 0) + 1;
  }
  return {
    schemaVersion: 2,
    recoveryCoordinator: candidate.recoveryCoordinator,
    sourceCount: Object.keys(sources).length,
    recoveryMethodCounts: Object.fromEntries(
      Object.entries(recoveryMethodCounts).sort(([left], [right]) => left.localeCompare(right))
    ),
    packages,
  };
}

function readRecoverySources(candidate) {
  if (!isPlainObject(candidate) || Object.keys(candidate).length === 0) {
    throw new Error('Secret package recovery inventory source catalog is invalid');
  }
  for (const [sourceId, source] of Object.entries(candidate)) {
    if (!RECOVERY_SOURCE_PATTERN.test(sourceId) || !isPlainObject(source)) {
      throw new Error('Secret package recovery inventory source catalog is invalid');
    }
    if (
      !sameKeys(source, ['authority', 'method']) ||
      !RECOVERY_METHODS.has(source.method) ||
      typeof source.authority !== 'string' ||
      source.authority.length < 8 ||
      source.authority.length > 200 ||
      /[\u0000-\u001f\u007f]/u.test(source.authority)
    ) {
      throw new Error('Secret package recovery inventory source metadata is invalid');
    }
  }
  return candidate;
}

function readMemberSources(candidate, expectedNames, kind, environment, sources, usedSources) {
  if (!isPlainObject(candidate) || !sameKeys(candidate, expectedNames)) {
    throw new Error(
      `Secret package recovery inventory ${environment} requires exact ${kind} source coverage`
    );
  }
  for (const sourceId of Object.values(candidate)) {
    if (typeof sourceId !== 'string' || !Object.hasOwn(sources, sourceId)) {
      throw new Error(`Secret package recovery inventory ${environment} ${kind} source is unknown`);
    }
    usedSources.add(sourceId);
  }
  return candidate;
}

function readOwners(candidate, expectedNames, kind, environment) {
  if (!isPlainObject(candidate) || !sameKeys(candidate, expectedNames)) {
    throw new Error(
      `Secret package recovery inventory ${environment} requires exact ${kind} owner coverage`
    );
  }
  for (const owner of Object.values(candidate)) {
    if (typeof owner !== 'string' || !OWNER_PATTERN.test(owner)) {
      throw new Error(`Secret package recovery inventory ${environment} ${kind} owner is invalid`);
    }
  }
  return candidate;
}

function sameKeys(candidate, expected) {
  const actual = Object.keys(candidate).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((value, index) => value === wanted[index]);
}

function isPlainObject(candidate) {
  return typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate);
}

function parseArguments(argv) {
  if (argv.length % 2 !== 0) {
    throw new Error('Secret package manifest verifier arguments are invalid');
  }
  const optionNames = {
    '--manifest': 'manifestPath',
    '--recovery-manifest': 'recoveryPath',
    '--sources-manifest': 'sourcesPath',
  };
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    const property = optionNames[option];
    if (
      property === undefined ||
      typeof value !== 'string' ||
      value.length === 0 ||
      value.startsWith('--') ||
      Object.hasOwn(options, property)
    ) {
      throw new Error('Secret package manifest verifier arguments are invalid');
    }
    options[property] = resolve(value);
  }
  return options;
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const result = verifySecretPackages(parseArguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Secret package verification failed';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
