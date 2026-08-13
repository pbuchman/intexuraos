#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSecretPackageSources } from './build-secret-package.mjs';
import { loadSecretPackageManifest } from './lib/secret-package.mjs';

/** Validate both tracked manifests and return names/counts only. */
export function verifySecretPackages(options = {}) {
  const manifest = loadSecretPackageManifest(
    options.manifestPath === undefined ? {} : { manifestPath: options.manifestPath }
  );
  const sources = loadSecretPackageSources({
    manifest,
    ...(options.sourcesPath === undefined ? {} : { sourcesPath: options.sourcesPath }),
  });
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
  };
}

function parseArguments(argv) {
  if (argv.length % 2 !== 0) {
    throw new Error('Secret package manifest verifier arguments are invalid');
  }
  const optionNames = {
    '--manifest': 'manifestPath',
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
