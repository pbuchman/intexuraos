#!/usr/bin/env node

import { readFileSync } from 'node:fs';

function fail(message) {
  throw new Error(message);
}

function parseManifest(path) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`cannot read service manifest: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    fail('service manifest must be an object');
  }
  if (!Array.isArray(manifest.services)) fail('service manifest services must be an array');
  return manifest;
}

function renderProductionEntries(manifest) {
  const seenEnvironmentVariables = new Set();
  const lines = [];
  for (let index = 0; index < manifest.services.length; index += 1) {
    const service = manifest.services[index];
    if (service === null || typeof service !== 'object' || Array.isArray(service)) {
      fail(`services[${String(index)}] must be an object`);
    }
    const envSuffix = service.envSuffix;
    const apiPath = service.apiPath;
    if (typeof envSuffix !== 'string' || !/^[A-Z][A-Z0-9_]*$/u.test(envSuffix)) {
      fail(`services[${String(index)}].envSuffix must be an uppercase environment suffix`);
    }
    if (
      typeof apiPath !== 'string' ||
      !/^\/api(?:\/|$)/u.test(apiPath) ||
      /[\u0000-\u001f\u007f]/u.test(apiPath)
    ) {
      fail(`services[${String(index)}].apiPath must be a control-free repository API path`);
    }
    const environmentVariable = `INTEXURAOS_${envSuffix}_URL`;
    if (seenEnvironmentVariables.has(environmentVariable)) {
      fail(`duplicate production web environment variable: ${environmentVariable}`);
    }
    seenEnvironmentVariables.add(environmentVariable);
    lines.push(`${environmentVariable}\t${apiPath}`);
  }
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

try {
  const manifestPath = process.argv[2];
  if (manifestPath === undefined || process.argv.length !== 3) {
    fail('usage: render-production-web-service-env.mjs <service-manifest.json>');
  }
  process.stdout.write(renderProductionEntries(parseManifest(manifestPath)));
} catch (error) {
  process.stderr.write(
    `Production web service renderer error: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}
