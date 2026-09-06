#!/usr/bin/env bash

set -euo pipefail
umask 077

RENDERED_CONFIG="${RENDERED_CONFIG:-/home/deploy/.pm2/intexuraos-prod-ecosystem.json}"
[[ "${INTEXURAOS_ENVIRONMENT:-}" == 'prod' ]] || exit 1
[[ -r "${RENDERED_CONFIG}" ]] || exit 1

temporary_directory="$(mktemp -d "${TMPDIR:-/tmp}/intexuraos-matrix-corpus-readiness.XXXXXX")"
trap 'rm -rf -- "${temporary_directory}"' EXIT
chmod 700 "${temporary_directory}"

node - \
  "${RENDERED_CONFIG}" \
  "${temporary_directory}/auth-header" \
  "${temporary_directory}/acceptance-request.json" <<'NODE'
const fs = require('node:fs');

const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (config === null || typeof config !== 'object' || !Array.isArray(config.apps)) process.exit(1);

const app = (name) => {
  const matches = config.apps.filter((candidate) => candidate?.name === name);
  if (matches.length !== 1) process.exit(1);
  const env = matches[0]?.env;
  if (env === null || typeof env !== 'object' || Array.isArray(env)) process.exit(1);
  return env;
};
const whatsapp = app('whatsapp-service');
const intex = app('intex-agent');
const safeUserId = /^[A-Za-z0-9][A-Za-z0-9._:|-]{0,127}$/u;

for (const env of [whatsapp, intex]) {
  if (env.INTEXURAOS_MATRIX_CORPUS_ENABLED !== 'true') process.exit(1);
  if (env.INTEXURAOS_MATRIX_CORPUS_TRUSTED_RUNTIME !== 'hetzner-prod') process.exit(1);
  if (env.INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE !== 'hetzner-prod') process.exit(1);
  if (!safeUserId.test(env.INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID ?? '')) process.exit(1);
  if (typeof env.INTEXURAOS_INTERNAL_AUTH_TOKEN !== 'string' || env.INTEXURAOS_INTERNAL_AUTH_TOKEN.length === 0)
    process.exit(1);
}
if (whatsapp.INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID !== intex.INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID)
  process.exit(1);
if (whatsapp.INTEXURAOS_INTERNAL_AUTH_TOKEN !== intex.INTEXURAOS_INTERNAL_AUTH_TOKEN) process.exit(1);

fs.writeFileSync(process.argv[3], `X-Internal-Auth: ${whatsapp.INTEXURAOS_INTERNAL_AUTH_TOKEN}\n`, {
  mode: 0o600,
});
fs.writeFileSync(
  process.argv[4],
  JSON.stringify({
    runtimeAudience: 'hetzner-prod',
    userId: whatsapp.INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID,
  }),
  { mode: 0o600 }
);
NODE

curl --fail --silent --show-error --max-time 10 \
  --header "@${temporary_directory}/auth-header" \
  --output "${temporary_directory}/whatsapp.json" \
  http://127.0.0.1:8113/internal/matrix-corpus/readiness
curl --fail --silent --show-error --max-time 10 \
  --header "@${temporary_directory}/auth-header" \
  --header 'Content-Type: application/json' \
  --data-binary "@${temporary_directory}/acceptance-request.json" \
  --output "${temporary_directory}/intex.json" \
  http://127.0.0.1:8134/internal/matrix-corpus/current-acceptance

node - "${temporary_directory}/whatsapp.json" "${temporary_directory}/intex.json" <<'NODE'
const fs = require('node:fs');

const parse = (path) => JSON.parse(fs.readFileSync(path, 'utf8'));
const whatsapp = parse(process.argv[2]);
const intex = parse(process.argv[3]);
const exactKeys = (value, keys) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');

if (!exactKeys(whatsapp, ['success', 'data', 'diagnostics']) || whatsapp.success !== true) process.exit(1);
if (!exactKeys(whatsapp.data, ['status']) || whatsapp.data.status !== 'ready') process.exit(1);
if (!exactKeys(intex, ['success', 'data', 'diagnostics']) || intex.success !== true) process.exit(1);
if (!exactKeys(intex.data, ['kind', ...(intex.data.kind === 'admission_ready' ? ['current'] : intex.data.kind === 'admission_blocked' ? ['reason'] : [])])) process.exit(1);
if (!['admission_ready', 'admission_blocked', 'not_ready'].includes(intex.data.kind)) process.exit(1);
if (intex.data.kind === 'not_ready') process.exit(1);
NODE
