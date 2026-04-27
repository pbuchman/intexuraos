'use strict';
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const CLOUDBUILD =
  process.env.WEB_ENV_LOCKSTEP_CLOUDBUILD ?? path.join(REPO_ROOT, 'apps/web/cloudbuild.yaml');
const CONFIG_TS =
  process.env.WEB_ENV_LOCKSTEP_CONFIG ?? path.join(REPO_ROOT, 'apps/web/src/config.ts');
const DEPLOY_YML =
  process.env.WEB_ENV_LOCKSTEP_DEPLOY_YML ?? path.join(REPO_ROOT, '.github/workflows/deploy.yml');

function extractCloudRunSuffixes(arrayBody) {
  return [...arrayBody.matchAll(/"[^"]+:([A-Z0-9_]+)"/g)].map((x) => x[1]);
}

function extractFromCloudbuild(src) {
  const m = src.match(/CLOUD_RUN_SERVICES=\(([\s\S]*?)\)/);
  if (!m) throw new Error('CLOUD_RUN_SERVICES array not found in cloudbuild.yaml');
  const suffixes = extractCloudRunSuffixes(m[1]);
  return new Set(suffixes.map((s) => `INTEXURAOS_${s}_URL`));
}

function extractFromConfig(src) {
  const m = [...src.matchAll(/getServiceUrl\('([A-Z0-9_]+)'/g)];
  return new Set(m.map((x) => x[1]));
}

// deploy.yml carries TWO independent CLOUD_RUN_SERVICES arrays (monolith-deploy
// and per-service web-deploy). Both must agree with cloudbuild.yaml or the
// workflow you happen to take in prod will silently bake the wrong env.
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
  const cloudbuild = extractFromCloudbuild(fs.readFileSync(CLOUDBUILD, 'utf-8'));
  const config = extractFromConfig(fs.readFileSync(CONFIG_TS, 'utf-8'));
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

module.exports = { extractFromCloudbuild, extractFromConfig, extractFromDeployYml };
