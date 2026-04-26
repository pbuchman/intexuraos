'use strict';
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const CLOUDBUILD = path.join(REPO_ROOT, 'apps/web/cloudbuild.yaml');
const CONFIG_TS = path.join(REPO_ROOT, 'apps/web/src/config.ts');

function extractFromCloudbuild(src) {
  const m = src.match(/CLOUD_RUN_SERVICES=\(([\s\S]*?)\)/);
  if (!m) throw new Error('CLOUD_RUN_SERVICES array not found in cloudbuild.yaml');
  const suffixes = [...m[1].matchAll(/"[^"]+:([A-Z0-9_]+)"/g)].map((x) => x[1]);
  return new Set(suffixes.map((s) => `INTEXURAOS_${s}_URL`));
}

function extractFromConfig(src) {
  const m = [...src.matchAll(/getServiceUrl\('([A-Z0-9_]+)'/g)];
  return new Set(m.map((x) => x[1]));
}

function main() {
  const cloudbuild = extractFromCloudbuild(fs.readFileSync(CLOUDBUILD, 'utf-8'));
  const config = extractFromConfig(fs.readFileSync(CONFIG_TS, 'utf-8'));
  const errors = [];
  for (const name of cloudbuild) {
    if (!config.has(name)) errors.push(`cloudbuild fetches ${name} but config.ts does not consume it`);
  }
  for (const name of config) {
    if (!cloudbuild.has(name)) errors.push(`config.ts consumes ${name} but cloudbuild does not fetch it`);
  }
  if (errors.length > 0) {
    console.error('Web env-var drift detected:');
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }
  console.log('Web env-var lockstep OK');
}

main();
