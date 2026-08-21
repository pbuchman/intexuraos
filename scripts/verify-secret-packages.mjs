#!/usr/bin/env node

import { loadSecretPackageSources } from './build-secret-package.mjs';
import { loadSecretPackageManifest } from './lib/secret-package.mjs';

/** Validate the active package manifest and its base-package rebuild sources. */
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
      packages: sources.packages,
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.stdout.write(`${JSON.stringify(verifySecretPackages())}\n`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Secret package verification failed'}\n`
    );
    process.exitCode = 1;
  }
}
