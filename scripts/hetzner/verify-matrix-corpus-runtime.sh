#!/usr/bin/env bash

set -euo pipefail
umask 077

ENV_FILE="${ENV_FILE:-/etc/intexuraos/.env.prod}"
[[ "${INTEXURAOS_ENVIRONMENT:-}" == 'prod' ]] || exit 1
[[ -r "${ENV_FILE}" ]] || exit 1

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

[[ "${INTEXURAOS_MATRIX_CORPUS_ENABLED:-}" == 'true' ]] || exit 1
[[ "${INTEXURAOS_MATRIX_CORPUS_TRUSTED_RUNTIME:-}" == 'hetzner-prod' ]] || exit 1
[[ "${INTEXURAOS_MATRIX_CORPUS_RUNTIME_AUDIENCE:-}" == 'hetzner-prod' ]] || exit 1
[[ "${INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID:-}" =~ ^[A-Za-z0-9][A-Za-z0-9._:|-]{0,127}$ ]] || exit 1
[[ -n "${INTEXURAOS_INTERNAL_AUTH_TOKEN:-}" ]] || exit 1

temporary_directory="$(mktemp -d "${TMPDIR:-/tmp}/intexuraos-matrix-corpus-readiness.XXXXXX")"
trap 'rm -rf -- "${temporary_directory}"' EXIT
chmod 700 "${temporary_directory}"

printf 'X-Internal-Auth: %s\n' "${INTEXURAOS_INTERNAL_AUTH_TOKEN}" > "${temporary_directory}/auth-header"
node -e 'require("node:fs").writeFileSync(process.argv[1], JSON.stringify({ runtimeAudience: "hetzner-prod", userId: process.env.INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID }))' \
  "${temporary_directory}/acceptance-request.json"

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
