#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  generateServiceWiring,
  loadServiceManifest,
  parseArgs as parseGeneratorArgs,
} from './generate-service-wiring.mjs';

function readRequiredFile(filePath, label) {
  if (!existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath}`);
  }

  return readFileSync(filePath, 'utf8');
}

function parseArgs(argv) {
  return parseGeneratorArgs(argv);
}

function parseConfigServiceUrls(source) {
  return new Map(
    [...source.matchAll(/getServiceUrl\(\s*'([A-Z0-9_]+)'\s*,\s*'([^']+)'\s*\)/g)].map((match) => [
      match[1],
      match[2],
    ])
  );
}

function parseViteApiProxy(source) {
  return new Map(
    [...source.matchAll(/^\s*'([^']+)':\s*\{\s*target:\s*'([^']+)'/gm)].map((match) => [
      match[1],
      match[2],
    ])
  );
}

function parseObjectLiteralEntries(source, objectName) {
  const blockMatch = source.match(
    new RegExp(`const\\s+${objectName}\\s*=\\s*\\{([\\s\\S]*?)\\n\\};`)
  );

  if (!blockMatch) {
    throw new Error(`Could not find ${objectName} in ecosystem.config.cjs`);
  }

  return new Map(
    [...blockMatch[1].matchAll(/^\s*([A-Z0-9_]+):\s*'([^']+)'/gm)].map((match) => [
      match[1],
      match[2],
    ])
  );
}

function compareExactMap(expectedEntries, actualMap, label, actualLabel) {
  const expectedMap = new Map(expectedEntries.map((entry) => [entry.key, entry.value]));
  const errors = [];

  for (const [key, value] of expectedMap) {
    const actual = actualMap.get(key);
    if (actual === undefined) {
      errors.push(`${actualLabel} is missing ${key} (${label} ${value})`);
      continue;
    }
    if (actual !== value) {
      errors.push(`${actualLabel} has ${key} -> ${actual}; expected ${value}`);
    }
  }

  for (const [key, value] of actualMap) {
    if (!expectedMap.has(key)) {
      errors.push(`${actualLabel} has extra ${key} -> ${value}`);
    }
  }

  return errors;
}

function compareSubsetMap(expectedEntries, actualMap, actualLabel) {
  const errors = [];

  for (const { key, value } of expectedEntries) {
    const actual = actualMap.get(key);
    if (actual === undefined) {
      errors.push(`${actualLabel} is missing ${key}`);
      continue;
    }
    if (actual !== value) {
      errors.push(`${actualLabel} has ${key} -> ${actual}; expected ${value}`);
    }
  }

  return errors;
}

function main() {
  try {
    const { root } = parseArgs(process.argv);
    const manifestPath = resolve(root, 'apps/web/service-manifest.json');
    const configPath = resolve(root, 'apps/web/src/config.ts');
    const viteConfigPath = resolve(root, 'apps/web/vite.config.ts');
    const ecosystemPath = resolve(root, 'ecosystem.config.cjs');

    const manifest = loadServiceManifest(manifestPath);
    const wiring = generateServiceWiring(manifest);
    const configMap = parseConfigServiceUrls(
      readRequiredFile(configPath, 'apps/web/src/config.ts')
    );
    const viteProxyMap = parseViteApiProxy(
      readRequiredFile(viteConfigPath, 'apps/web/vite.config.ts')
    );
    const commonServiceUrls = parseObjectLiteralEntries(
      readRequiredFile(ecosystemPath, 'ecosystem.config.cjs'),
      'COMMON_SERVICE_URLS'
    );

    const errors = [
      ...compareExactMap(
        wiring.configEntries.map(({ envVar, apiPath }) => ({ key: envVar, value: apiPath })),
        configMap,
        'apiPath',
        'apps/web/src/config.ts'
      ),
      ...compareExactMap(
        wiring.proxyEntries.map(({ apiPath, target }) => ({ key: apiPath, value: target })),
        viteProxyMap,
        'proxy target',
        'apps/web/vite.config.ts'
      ),
      ...compareSubsetMap(
        wiring.commonServiceUrls.map(({ envVar, url }) => ({ key: envVar, value: url })),
        commonServiceUrls,
        'ecosystem.config.cjs COMMON_SERVICE_URLS'
      ),
    ];

    if (errors.length > 0) {
      console.error('Service wiring drift detected:');
      for (const error of errors) {
        console.error(`  - ${error}`);
      }
      process.exit(1);
    }

    console.log(`✓ Service wiring verified (${String(wiring.services.length)} services)`);
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

export {
  compareExactMap,
  compareSubsetMap,
  parseArgs,
  parseConfigServiceUrls,
  parseObjectLiteralEntries,
  parseViteApiProxy,
};
