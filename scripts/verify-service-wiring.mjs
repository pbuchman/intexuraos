#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  generateServiceWiring,
  loadServiceManifest,
  parseArgs as parseGeneratorArgs,
  renderConfigGenerated,
  renderEcosystemGenerated,
  renderTerraformServiceUrls,
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

function compareGeneratedFile(expected, actualPath, label) {
  const actual = readRequiredFile(actualPath, label);
  return actual === expected
    ? []
    : [`${label} is stale; run node scripts/generate-service-wiring.mjs`];
}

function requireGeneratedConsumption(source, pattern, message) {
  return pattern.test(source) ? [] : [message];
}

function main() {
  try {
    const { root } = parseArgs(process.argv);
    const manifestPath = resolve(root, 'apps/web/service-manifest.json');
    const configPath = resolve(root, 'apps/web/src/config.ts');
    const viteConfigPath = resolve(root, 'apps/web/vite.config.ts');
    const ecosystemPath = resolve(root, 'ecosystem.config.cjs');
    const generatedConfigPath = resolve(root, 'apps/web/src/config.generated.ts');
    const generatedEcosystemPath = resolve(root, 'ecosystem.generated.cjs');
    const generatedTerraformPath = resolve(
      root,
      'terraform/environments/dev/service-urls.auto.tfvars.json'
    );

    const manifest = loadServiceManifest(manifestPath);
    const wiring = generateServiceWiring(manifest);
    const configSource = readRequiredFile(configPath, 'apps/web/src/config.ts');
    const viteConfigSource = readRequiredFile(viteConfigPath, 'apps/web/vite.config.ts');
    const ecosystemSource = readRequiredFile(ecosystemPath, 'ecosystem.config.cjs');
    const generatedCommonServiceUrls = parseObjectLiteralEntries(
      readRequiredFile(generatedEcosystemPath, 'ecosystem.generated.cjs'),
      'COMMON_SERVICE_URLS_GENERATED'
    );

    const errors = [
      ...requireGeneratedConsumption(
        configSource,
        /WEB_SERVICE_URLS/,
        'apps/web/src/config.ts must import WEB_SERVICE_URLS from config.generated.ts'
      ),
      ...requireGeneratedConsumption(
        viteConfigSource,
        /WEB_SERVICE_URLS[\s\S]*proxyTarget|proxyTarget[\s\S]*WEB_SERVICE_URLS/,
        'apps/web/vite.config.ts must import WEB_SERVICE_URLS and use generated proxyTarget values'
      ),
      ...compareSubsetMap(
        wiring.commonServiceUrls.map(({ envVar, url }) => ({ key: envVar, value: url })),
        generatedCommonServiceUrls,
        'ecosystem.generated.cjs COMMON_SERVICE_URLS_GENERATED'
      ),
      ...requireGeneratedConsumption(
        ecosystemSource,
        /ecosystem\.generated\.cjs[\s\S]*COMMON_SERVICE_URLS_GENERATED|COMMON_SERVICE_URLS_GENERATED[\s\S]*ecosystem\.generated\.cjs/,
        'ecosystem.config.cjs must require ecosystem.generated.cjs and use COMMON_SERVICE_URLS_GENERATED'
      ),
      ...compareGeneratedFile(
        renderConfigGenerated(wiring),
        generatedConfigPath,
        'apps/web/src/config.generated.ts'
      ),
      ...compareGeneratedFile(
        renderEcosystemGenerated(wiring),
        generatedEcosystemPath,
        'ecosystem.generated.cjs'
      ),
      ...compareGeneratedFile(
        renderTerraformServiceUrls(wiring),
        generatedTerraformPath,
        'terraform/environments/dev/service-urls.auto.tfvars.json'
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
  compareGeneratedFile,
  parseObjectLiteralEntries,
  requireGeneratedConsumption,
};
