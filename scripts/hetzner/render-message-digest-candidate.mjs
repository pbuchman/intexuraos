#!/usr/bin/env node

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const CANDIDATE_PORTS = Object.freeze({
  'whatsapp-service': 18113,
  'mobile-notifications-service': 18114,
  'fishing-assistant-service': 18119,
  'message-digest-service': 18135,
});
const CANDIDATE_ORDER = Object.freeze(Object.keys(CANDIDATE_PORTS));
const SERVICE_URLS = Object.freeze({
  INTEXURAOS_WHATSAPP_SERVICE_URL: 'http://127.0.0.1:18113',
  INTEXURAOS_MOBILE_NOTIFICATIONS_SERVICE_URL: 'http://127.0.0.1:18114',
  INTEXURAOS_FISHING_ASSISTANT_SERVICE_URL: 'http://127.0.0.1:18119',
  INTEXURAOS_MESSAGE_DIGEST_SERVICE_URL: 'http://127.0.0.1:18135',
});

export function renderMessageDigestCandidateConfig(config) {
  if (!isRecord(config) || !Array.isArray(config.apps)) {
    throw new Error('CANDIDATE_CONFIG_INVALID');
  }
  const byName = new Map(config.apps.map((app) => [app?.name, app]));
  const apps = CANDIDATE_ORDER.map((serviceName) => {
    const source = byName.get(serviceName);
    if (!isRecord(source) || !isRecord(source.env)) {
      throw new Error('CANDIDATE_CONFIG_INVALID');
    }
    return {
      ...source,
      name: `candidate-${serviceName}`,
      env: {
        ...source.env,
        ...SERVICE_URLS,
        PORT: String(CANDIDATE_PORTS[serviceName]),
      },
    };
  });
  return { apps };
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const entryPath = process.argv[1] === undefined ? null : resolve(process.argv[1]);
if (entryPath !== null && entryPath === fileURLToPath(import.meta.url)) {
  const sourcePath = process.argv[2];
  if (sourcePath === undefined)
    throw new Error('Usage: render-message-digest-candidate.mjs <config>');
  const require = createRequire(import.meta.url);
  const config = require(resolve(sourcePath));
  process.stdout.write(`${JSON.stringify(renderMessageDigestCandidateConfig(config), null, 2)}\n`);
}
