'use strict';
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const MANIFEST =
  process.env.WEB_ENV_LOCKSTEP_MANIFEST ?? path.join(REPO_ROOT, 'apps/web/service-manifest.json');
const CONFIG_TS =
  process.env.WEB_ENV_LOCKSTEP_CONFIG ?? path.join(REPO_ROOT, 'apps/web/src/config.ts');
const CONFIG_GENERATED =
  process.env.WEB_ENV_LOCKSTEP_CONFIG_GENERATED ??
  path.join(REPO_ROOT, 'apps/web/src/config.generated.ts');
const DEPLOY_YML =
  process.env.WEB_ENV_LOCKSTEP_DEPLOY_YML ?? path.join(REPO_ROOT, '.github/workflows/deploy.yml');

function extractCloudRunSuffixes(arrayBody) {
  return [...arrayBody.matchAll(/"[^"]+:([A-Z0-9_]+)"/g)].map((x) => x[1]);
}

// Source of truth for the web bundle's Cloud Run URLs is
// apps/web/service-manifest.json. apps/web/cloudbuild.yaml reads it at build
// time via `jq`, so it cannot be regex'd here. Re-deriving from the manifest
// keeps "what cloudbuild fetches" and "what we lockstep against" in sync.
function extractFromManifest(src) {
  let parsed;
  try {
    parsed = JSON.parse(src);
  } catch (err) {
    throw new Error(`service-manifest.json is not valid JSON: ${err.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.services)) {
    throw new Error('service-manifest.json must have a "services" array');
  }
  return new Set(
    parsed.services.map((s, i) => {
      if (!s || typeof s.envSuffix !== 'string' || s.envSuffix.length === 0) {
        throw new Error(`service-manifest.json services[${i}] is missing string "envSuffix"`);
      }
      return `INTEXURAOS_${s.envSuffix}_URL`;
    })
  );
}

function extractFromConfig(src) {
  const m = [...src.matchAll(/getServiceUrl\('([A-Z0-9_]+)'/g)];
  return new Set(m.map((x) => x[1]));
}

function extractFromGeneratedConfig(src) {
  const m = [...src.matchAll(/envVar:\s*'([A-Z0-9_]+)'/g)];
  return new Set(m.map((x) => x[1]));
}

// deploy.yml carries TWO independent CLOUD_RUN_SERVICES arrays (monolith-deploy
// and per-service web-deploy). Both must agree with the manifest or the
// workflow you happen to take in prod will silently bake the wrong env. The
// migration of these two arrays to read from the manifest is tracked as a
// follow-up — it requires the GitHub `workflows` permission scope (see the
// note in scripts/verify-web-service-manifest.mjs).
function extractFromDeployYml(src) {
  const matches = [...src.matchAll(/CLOUD_RUN_SERVICES=\(([\s\S]*?)\)/g)];
  if (matches.length === 0) throw new Error('CLOUD_RUN_SERVICES array not found in deploy.yml');
  return matches.map(
    (m) => new Set(extractCloudRunSuffixes(m[1]).map((s) => `INTEXURAOS_${s}_URL`))
  );
}

function diff(label, expected, actual) {
  const errors = [];
  for (const name of expected) if (!actual.has(name)) errors.push(`${label} is missing ${name}`);
  for (const name of actual) if (!expected.has(name)) errors.push(`${label} has extra ${name}`);
  return errors;
}

function main() {
  const cloudbuild = extractFromManifest(fs.readFileSync(MANIFEST, 'utf-8'));
  const configSource = fs.readFileSync(CONFIG_TS, 'utf-8');
  const config = configSource.includes('WEB_SERVICE_URLS')
    ? extractFromGeneratedConfig(fs.readFileSync(CONFIG_GENERATED, 'utf-8'))
    : extractFromConfig(configSource);
  const deployArrays = extractFromDeployYml(fs.readFileSync(DEPLOY_YML, 'utf-8'));

  const errors = [];
  for (const name of cloudbuild)
    if (!config.has(name))
      errors.push(`cloudbuild fetches ${name} but config.ts does not consume it`);
  for (const name of config)
    if (!cloudbuild.has(name))
      errors.push(`config.ts consumes ${name} but cloudbuild does not fetch it`);

  deployArrays.forEach((arr, i) => {
    errors.push(...diff(`deploy.yml[${i}]`, cloudbuild, arr));
  });

  if (errors.length > 0) {
    console.error('Web env-var drift detected:');
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }
  console.log('Web env-var lockstep OK');
}

if (require.main === module) main();

module.exports = {
  extractFromManifest,
  extractFromConfig,
  extractFromDeployYml,
  extractFromGeneratedConfig,
};
