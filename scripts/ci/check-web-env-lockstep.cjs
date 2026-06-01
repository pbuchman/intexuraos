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

// Source of truth for web service URLs is apps/web/service-manifest.json.
// Hetzner deploys render production values from this manifest; local dev and
// the web config consume the generated files derived from the same source.
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

function main() {
  const manifest = extractFromManifest(fs.readFileSync(MANIFEST, 'utf-8'));
  const configSource = fs.readFileSync(CONFIG_TS, 'utf-8');
  const config = configSource.includes('WEB_SERVICE_URLS')
    ? extractFromGeneratedConfig(fs.readFileSync(CONFIG_GENERATED, 'utf-8'))
    : extractFromConfig(configSource);

  const errors = [];
  for (const name of manifest)
    if (!config.has(name)) errors.push(`manifest lists ${name} but config.ts does not consume it`);
  for (const name of config)
    if (!manifest.has(name))
      errors.push(`config.ts consumes ${name} but manifest does not list it`);

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
  extractFromGeneratedConfig,
};
