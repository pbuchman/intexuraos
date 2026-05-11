#!/usr/bin/env node
/**
 * Web Service Manifest Verification
 *
 * Validates apps/web/service-manifest.json — the single source of truth for
 * Cloud Run services injected into the web bundle at build time.
 *
 * Checks:
 *   1. Manifest shape:
 *      { services: Array<{ name, envSuffix, apiPath, proxyTarget, serviceUrl }> }
 *      with regex-validated values.
 *   2. Each manifest entry has a corresponding `module "<name_with_underscores>" {`
 *      declaration in terraform/environments/dev/main.tf.
 *   3. No `CLOUD_RUN_SERVICES=(` literal array remains in apps/web/cloudbuild.yaml —
 *      anywhere, including comments. Substring match (matches the companion vitest).
 *
 * NOTE: The plan also calls for forbidding the literal in `.github/workflows/deploy.yml`,
 *       but that file currently still contains the bash arrays. The code-worker GitHub
 *       App lacks `workflows` permission and cannot push edits to workflow files; the
 *       deploy.yml migration to manifest-based reads is tracked as a follow-up that
 *       must be applied by a human (or an actor with workflows scope). When that lands,
 *       extend `assertNoLiteralArray` to deploy.yml and remove this note.
 *
 * Exit code 1 on any failure with a clear `❌ <reason>` message.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const manifestPath = resolve(repoRoot, 'apps/web/service-manifest.json');
const terraformMainPath = resolve(repoRoot, 'terraform/environments/dev/main.tf');
const cloudbuildPath = resolve(repoRoot, 'apps/web/cloudbuild.yaml');

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

function validateTerraformModules(manifest) {
  if (!existsSync(terraformMainPath)) {
    fail(`Terraform main.tf not found: ${terraformMainPath}`);
  }
  const tf = readFileSync(terraformMainPath, 'utf8');
  const missing = [];
  for (const entry of manifest.services) {
    const moduleName = entry.name.replace(/-/g, '_');
    const re = new RegExp(`module\\s+"${moduleName}"\\s+\\{`);
    if (!re.test(tf)) {
      missing.push({ service: entry.name, module: moduleName });
    }
  }
  if (missing.length > 0) {
    const list = missing.map((m) => `module "${m.module}" (for service "${m.service}")`).join(', ');
    fail(`Missing terraform module(s) in terraform/environments/dev/main.tf: ${list}`);
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

function main() {
  const manifest = loadManifest();
  validateShape(manifest);
  validateTerraformModules(manifest);
  assertNoLiteralArray(cloudbuildPath, 'apps/web/cloudbuild.yaml');

  console.log(`✓ Web service manifest valid (${manifest.services.length} services)`);
}

main();
