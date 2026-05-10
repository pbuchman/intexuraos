#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const NAME_REGEX = /^[a-z][a-z0-9-]+$/;
const ENV_SUFFIX_REGEX = /^[A-Z][A-Z0-9_]+$/;
const API_PATH_REGEX = /^\/api\/[a-z0-9-]+$/;
const URL_REGEX = /^https?:\/\/\S+$/;

function parseArgs(argv) {
  const args = argv.slice(2);
  let root = resolve(import.meta.dirname, '..');

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root') {
      const next = args[i + 1];
      if (typeof next !== 'string' || next.length === 0 || next.startsWith('--')) {
        throw new Error('--root requires a directory argument');
      }
      root = resolve(next);
      i++;
    }
  }

  return { root };
}

function stripTrailingSlash(value) {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function readRequiredFile(filePath, label) {
  if (!existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath}`);
  }

  return readFileSync(filePath, 'utf8');
}

function loadServiceManifest(manifestPath) {
  let manifest;

  try {
    manifest = JSON.parse(readRequiredFile(manifestPath, 'Manifest'));
  } catch (error) {
    throw new Error(`service-manifest.json is not valid JSON: ${error.message}`);
  }

  if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.services)) {
    throw new Error('service-manifest.json must have a "services" array');
  }

  const seenNames = new Set();
  const seenEnvSuffixes = new Set();
  const seenApiPaths = new Set();

  manifest.services.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`services[${index}] is not an object`);
    }

    if (typeof entry.name !== 'string' || !NAME_REGEX.test(entry.name)) {
      throw new Error(`services[${index}].name must match ${NAME_REGEX}`);
    }
    if (typeof entry.envSuffix !== 'string' || !ENV_SUFFIX_REGEX.test(entry.envSuffix)) {
      throw new Error(`services[${index}].envSuffix must match ${ENV_SUFFIX_REGEX}`);
    }
    if (typeof entry.apiPath !== 'string' || !API_PATH_REGEX.test(entry.apiPath)) {
      throw new Error(`services[${index}].apiPath must match ${API_PATH_REGEX}`);
    }
    if (typeof entry.proxyTarget !== 'string' || !URL_REGEX.test(entry.proxyTarget)) {
      throw new Error(`services[${index}].proxyTarget must be an absolute http(s) URL`);
    }
    if (typeof entry.serviceUrl !== 'string' || !URL_REGEX.test(entry.serviceUrl)) {
      throw new Error(`services[${index}].serviceUrl must be an absolute http(s) URL`);
    }

    if (seenNames.has(entry.name)) {
      throw new Error(`Duplicate service name in manifest: ${entry.name}`);
    }
    if (seenEnvSuffixes.has(entry.envSuffix)) {
      throw new Error(`Duplicate envSuffix in manifest: ${entry.envSuffix}`);
    }
    if (seenApiPaths.has(entry.apiPath)) {
      throw new Error(`Duplicate apiPath in manifest: ${entry.apiPath}`);
    }

    seenNames.add(entry.name);
    seenEnvSuffixes.add(entry.envSuffix);
    seenApiPaths.add(entry.apiPath);
  });

  return manifest;
}

function normalizeService(entry) {
  const serviceUrl = stripTrailingSlash(entry.serviceUrl);

  return {
    ...entry,
    envVar: `INTEXURAOS_${entry.envSuffix}_URL`,
    openapiUrl: `${serviceUrl}/openapi.json`,
  };
}

function generateServiceWiring(manifest) {
  const services = manifest.services.map(normalizeService);

  return {
    services,
    configEntries: services.map(({ envVar, apiPath }) => ({ envVar, apiPath })),
    proxyEntries: services.map(({ apiPath, proxyTarget }) => ({ apiPath, target: proxyTarget })),
    commonServiceUrls: services.map(({ envVar, serviceUrl }) => ({ envVar, url: serviceUrl })),
  };
}

function main() {
  try {
    const { root } = parseArgs(process.argv);
    const manifestPath = resolve(root, 'apps/web/service-manifest.json');
    const manifest = loadServiceManifest(manifestPath);
    process.stdout.write(`${JSON.stringify(generateServiceWiring(manifest), null, 2)}\n`);
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename ?? '');

if (invokedDirectly) {
  main();
}

export { generateServiceWiring, loadServiceManifest, normalizeService, parseArgs };
