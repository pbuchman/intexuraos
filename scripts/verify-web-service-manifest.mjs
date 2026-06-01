#!/usr/bin/env node
/**
 * Web Service Manifest Verification
 *
 * Validates apps/web/service-manifest.json — the single source of truth for
 * service URLs injected into local dev and Hetzner web builds.
 *
 * Checks:
 *   1. Manifest shape:
 *      { services: Array<{ name, envSuffix, apiPath, proxyTarget, serviceUrl }> }
 *      with regex-validated values.
 *   2. Generated Terraform service URL tfvars match manifest serviceUrl values.
 *   3. Obsolete GCP Cloud Build web configs and deploy.yml service arrays are gone.
 *   4. The PWA navigation fallback excludes retained bucket routes.
 *
 * Exit code 1 on any failure with a clear `❌ <reason>` message.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const manifestPath = resolve(repoRoot, 'apps/web/service-manifest.json');
const cloudbuildPath = resolve(repoRoot, 'apps/web/cloudbuild.yaml');
const monolithCloudbuildPath = resolve(repoRoot, 'cloudbuild/cloudbuild.yaml');
const deployWorkflowPath = resolve(repoRoot, '.github/workflows/deploy.yml');
const terraformServiceUrlsPath = resolve(
  repoRoot,
  'terraform/environments/dev/service-urls.auto.tfvars.json'
);
const viteConfigPath = resolve(repoRoot, 'apps/web/vite.config.ts');

const NAME_REGEX = /^[a-z][a-z0-9-]+$/;
const ENV_SUFFIX_REGEX = /^[A-Z][A-Z0-9_]+$/;
const API_PATH_REGEX = /^\/api\/[a-z0-9-]+$/;
const URL_REGEX = /^https?:\/\/\S+$/;
const FORBIDDEN_LITERAL = /CLOUD_RUN_SERVICES=\(/;

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function loadManifest() {
  if (!existsSync(manifestPath)) {
    fail(`Manifest not found: ${manifestPath}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    fail(`Manifest is not valid JSON: ${err.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.services)) {
    fail('Manifest must have a "services" array');
  }
  return parsed;
}

function validateShape(manifest) {
  if (manifest.services.length === 0) {
    fail('Manifest "services" array is empty');
  }
  const seenNames = new Set();
  const seenEnvSuffixes = new Set();
  const seenApiPaths = new Set();
  manifest.services.forEach((entry, idx) => {
    if (!entry || typeof entry !== 'object') {
      fail(`services[${idx}] is not an object`);
    }
    if (typeof entry.name !== 'string' || entry.name.length === 0) {
      fail(`services[${idx}].name must be a non-empty string`);
    }
    if (!NAME_REGEX.test(entry.name)) {
      fail(`services[${idx}].name "${entry.name}" must match ${NAME_REGEX}`);
    }
    if (typeof entry.envSuffix !== 'string' || entry.envSuffix.length === 0) {
      fail(`services[${idx}].envSuffix must be a non-empty string`);
    }
    if (!ENV_SUFFIX_REGEX.test(entry.envSuffix)) {
      fail(`services[${idx}].envSuffix "${entry.envSuffix}" must match ${ENV_SUFFIX_REGEX}`);
    }
    if (typeof entry.apiPath !== 'string' || entry.apiPath.length === 0) {
      fail(`services[${idx}].apiPath must be a non-empty string`);
    }
    if (!API_PATH_REGEX.test(entry.apiPath)) {
      fail(`services[${idx}].apiPath "${entry.apiPath}" must match ${API_PATH_REGEX}`);
    }
    if (typeof entry.proxyTarget !== 'string' || !URL_REGEX.test(entry.proxyTarget)) {
      fail(`services[${idx}].proxyTarget must be an absolute http(s) URL`);
    }
    if (typeof entry.serviceUrl !== 'string' || !URL_REGEX.test(entry.serviceUrl)) {
      fail(`services[${idx}].serviceUrl must be an absolute http(s) URL`);
    }
    if (seenNames.has(entry.name)) {
      fail(`Duplicate service name in manifest: ${entry.name}`);
    }
    if (seenEnvSuffixes.has(entry.envSuffix)) {
      fail(`Duplicate envSuffix in manifest: ${entry.envSuffix}`);
    }
    if (seenApiPaths.has(entry.apiPath)) {
      fail(`Duplicate apiPath in manifest: ${entry.apiPath}`);
    }
    seenNames.add(entry.name);
    seenEnvSuffixes.add(entry.envSuffix);
    seenApiPaths.add(entry.apiPath);
  });
}

function validateTerraformServiceUrls(manifest) {
  if (!existsSync(terraformServiceUrlsPath)) {
    fail(`Terraform service URL tfvars not found: ${terraformServiceUrlsPath}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(terraformServiceUrlsPath, 'utf8'));
  } catch (err) {
    fail(`Terraform service URL tfvars are not valid JSON: ${err.message}`);
  }
  const serviceUrls = parsed?.service_urls;
  if (!serviceUrls || typeof serviceUrls !== 'object' || Array.isArray(serviceUrls)) {
    fail('Terraform service URL tfvars must contain an object at service_urls');
  }

  for (const entry of manifest.services) {
    const envVar = `INTEXURAOS_${entry.envSuffix}_URL`;
    if (serviceUrls[envVar] !== entry.serviceUrl) {
      fail(
        `Terraform service URL tfvars mismatch for ${envVar}: expected ${entry.serviceUrl}, got ${serviceUrls[envVar]}`
      );
    }
  }
}

function assertNoLiteralArray(filePath, label) {
  if (!existsSync(filePath)) {
    fail(`${label} not found: ${filePath}`);
  }
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FORBIDDEN_LITERAL.test(line)) {
      fail(
        `${label} contains a CLOUD_RUN_SERVICES=( literal array at line ${i + 1}; it must read from apps/web/service-manifest.json instead`
      );
    }
  }
}

function assertMissingFile(filePath, label) {
  if (existsSync(filePath)) {
    fail(`${label} must be removed after app/web deployment moved off GCP Cloud Build`);
  }
}

function assertViteRetainedBucketDenylist() {
  if (!existsSync(viteConfigPath)) {
    fail(`apps/web/vite.config.ts not found: ${viteConfigPath}`);
  }
  const content = readFileSync(viteConfigPath, 'utf8');
  if (!content.includes('navigateFallbackDenylist')) {
    fail('apps/web/vite.config.ts must configure workbox navigateFallbackDenylist');
  }
  for (const snippet of ['/^\\/share\\//', '/^\\/images\\//']) {
    if (!content.includes(snippet)) {
      fail(`apps/web/vite.config.ts navigateFallbackDenylist must include ${snippet}`);
    }
  }
}

function main() {
  const manifest = loadManifest();
  validateShape(manifest);
  validateTerraformServiceUrls(manifest);
  assertMissingFile(cloudbuildPath, 'apps/web/cloudbuild.yaml');
  assertMissingFile(monolithCloudbuildPath, 'cloudbuild/cloudbuild.yaml');
  assertNoLiteralArray(deployWorkflowPath, '.github/workflows/deploy.yml');
  assertViteRetainedBucketDenylist();

  console.log(`✓ Web service manifest valid (${manifest.services.length} services)`);
}

main();
