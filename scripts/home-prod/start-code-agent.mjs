// Runs as the isolated code-agent UID, from an operator-selected sealed release.
import { readFileSync, realpathSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import { createRequire } from 'node:module';
import { parse } from 'dotenv';
import { renderRuntimeConfig } from '../lib/runtime-config.mjs';

const credentials = process.env.CREDENTIALS_DIRECTORY;
if (!credentials || !isAbsolute(credentials)) {
  throw new Error('Missing systemd credentials');
}
const sha = basename(realpathSync('.'));
if (!/^[a-f0-9]{40}$/u.test(sha)) throw new Error('Unrecognized isolated release');
const projection = JSON.parse(readFileSync(join(credentials, 'application.json'), 'utf8'));
Object.assign(
  process.env,
  parse(renderRuntimeConfig({ environment: 'prod', format: 'dotenv' })),
  projection,
  {
    HOME: '/var/lib/intexuraos-code-agent-runtime',
    INTEXURAOS_PROD_ENV_FILE: '/dev/null',
    INTEXURAOS_PROD_PORT_OFFSET: '10000',
    INTEXURAOS_COMMIT_SHA: sha,
    INTEXURAOS_ENVIRONMENT: 'prod',
    INTEXURAOS_GCP_PROJECT_ID: 'intexuraos-dev-pbuchman',
    GOOGLE_CLOUD_PROJECT: 'intexuraos-dev-pbuchman',
    PROJECT_ID: 'intexuraos-dev-pbuchman',
    REGION: 'europe-central2',
    GOOGLE_APPLICATION_CREDENTIALS: join(credentials, 'runtime.json'),
    INTEXURAOS_TASK_ACCESS_SIGNING_KEY_PATH: join(credentials, 'signing.pem'),
  }
);
const require = createRequire(import.meta.url);
const config = require('../../ecosystem.config.prod.cjs').apps.find(
  (app) => app.name === 'code-agent'
);
if (config?.env.PORT !== '18128' || config.env.HOST !== '127.0.0.1') {
  throw new Error('Invalid isolated service configuration');
}
Object.assign(process.env, config.env);
// The same production entry point handles --preflight with external migrations and listening disabled.
process.chdir(config.cwd);
await import('../../apps/code-agent/dist/index.js');
