#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SECRET_PACKAGE_CLI="${REPO_ROOT}/scripts/secret-package.mjs"
RUNTIME_CONFIG_RENDERER="${REPO_ROOT}/scripts/render-runtime-config.mjs"
PROD_CANDIDATE_VALIDATOR="${PROD_CANDIDATE_VALIDATOR:-${REPO_ROOT}/scripts/hetzner/validate-prod-secret-candidate.sh}"
PROJECT_ID="${PROJECT_ID:-intexuraos-dev-pbuchman}"
REGION="${REGION:-europe-central2}"
SECRET_PACKAGE_VERSION="${SECRET_PACKAGE_VERSION:-}"
SECRET_PACKAGE_RENDER_DIR="${SECRET_PACKAGE_RENDER_DIR:-/var/lib/intexuraos/secret-packages/prod}"
SECRET_PROJECTION_ROOT="${SECRET_PROJECTION_ROOT:-/var/lib/intexuraos/secret-projections/prod}"
SECRET_PACKAGE_PAYLOAD_FILE="${SECRET_PACKAGE_PAYLOAD_FILE:-}"
OUTPUT_FILE="${OUTPUT_FILE:-/etc/intexuraos/.env.prod}"
PROVISIONER_SA_KEY_FILE="${PROVISIONER_SA_KEY_FILE:-${GOOGLE_APPLICATION_CREDENTIALS:-/home/deploy/provisioner-sa-key.json}}"
RUNTIME_SA_KEY_FILE="${RUNTIME_SA_KEY_FILE:-/home/deploy/runtime-sa-key.json}"
INTERNAL_AUTH_TOKEN_FILE="${INTERNAL_AUTH_TOKEN_FILE:-/etc/intexuraos/internal-auth-token}"
CLOUDFLARE_CREDENTIALS_FILE="${CLOUDFLARE_CREDENTIALS_FILE:-/etc/letsencrypt/cloudflare.ini}"
TLS_PRIVATE_KEY_FILE="${TLS_PRIVATE_KEY_FILE:-/etc/intexuraos/tls-private-key.pem}"
PACKAGE_METADATA_FILE="${PACKAGE_METADATA_FILE:-/etc/intexuraos/secret-package-metadata.json}"
PUBLIC_ORIGIN="${PUBLIC_ORIGIN:-https://intexuraos.cloud}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
DEPLOY_GROUP="${DEPLOY_GROUP:-${DEPLOY_USER}}"
NGINX_TOKEN_GROUP="${NGINX_TOKEN_GROUP:-www-data}"
EXPECTED_RUNTIME_SA_EMAIL="${EXPECTED_RUNTIME_SA_EMAIL:-ixos-hetzner-runtime-dev@${PROJECT_ID}.iam.gserviceaccount.com}"
SKIP_RUNTIME_CREDENTIAL_SMOKE="${SKIP_RUNTIME_CREDENTIAL_SMOKE:-0}"
SKIP_CLOUDFLARE_CREDENTIAL_SMOKE="${SKIP_CLOUDFLARE_CREDENTIAL_SMOKE:-${SKIP_RUNTIME_CREDENTIAL_SMOKE}}"
SKIP_OWNERSHIP="${SKIP_OWNERSHIP:-0}"
SECRET_PACKAGE_FETCH_TIMEOUT_SECONDS="${SECRET_PACKAGE_FETCH_TIMEOUT_SECONDS:-20}"
SECRET_PACKAGE_LOCK_TIMEOUT_SECONDS="${SECRET_PACKAGE_LOCK_TIMEOUT_SECONDS:-30}"
SECRET_PACKAGE_LOCK_FILE="${SECRET_PACKAGE_LOCK_FILE:-/run/lock/intexuraos/prod-secret-package.lock}"
STAGING_DIR=""
HOST_LOCK_FD=""
PORTABLE_LOCK_DIR=""
PACKAGE_RELEASE_DIR=""

usage() {
  cat <<EOF
Usage:
  INTEXURAOS_ENVIRONMENT=prod $(basename "$0") --version <n> [options]

Options:
  --version <n>          Exact PROD package version
  --project-id <id>      GCP project
  --output <path>        Production dotenv path
  --render-dir <path>    Private package render root
  --payload-file <path>  Offline test payload
  -h, --help             Show this help

This loader has no rollback, previous-release, or legacy mode. Services must be
stopped before it runs. Failure leaves them stopped for fix-forward recovery.
EOF
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

cleanup() {
  local status=$?
  trap - EXIT
  set +e
  [[ -n "${STAGING_DIR}" && -d "${STAGING_DIR}" ]] && rm -rf -- "${STAGING_DIR}"
  [[ -n "${PORTABLE_LOCK_DIR}" && -d "${PORTABLE_LOCK_DIR}" ]] && rmdir -- "${PORTABLE_LOCK_DIR}" 2>/dev/null
  exit "${status}"
}
trap cleanup EXIT

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --version)
        [[ $# -ge 2 ]] || fail '--version requires a value'
        SECRET_PACKAGE_VERSION="$2"
        shift 2
        ;;
      --version=*) SECRET_PACKAGE_VERSION="${1#*=}"; shift ;;
      --project-id)
        [[ $# -ge 2 ]] || fail '--project-id requires a value'
        PROJECT_ID="$2"
        shift 2
        ;;
      --project-id=*) PROJECT_ID="${1#*=}"; shift ;;
      --output)
        [[ $# -ge 2 ]] || fail '--output requires a value'
        OUTPUT_FILE="$2"
        shift 2
        ;;
      --output=*) OUTPUT_FILE="${1#*=}"; shift ;;
      --render-dir)
        [[ $# -ge 2 ]] || fail '--render-dir requires a value'
        SECRET_PACKAGE_RENDER_DIR="$2"
        shift 2
        ;;
      --render-dir=*) SECRET_PACKAGE_RENDER_DIR="${1#*=}"; shift ;;
      --payload-file)
        [[ $# -ge 2 ]] || fail '--payload-file requires a value'
        SECRET_PACKAGE_PAYLOAD_FILE="$2"
        shift 2
        ;;
      --payload-file=*) SECRET_PACKAGE_PAYLOAD_FILE="${1#*=}"; shift ;;
      -h|--help) usage; exit 0 ;;
      *) fail "Unknown argument: $1" ;;
    esac
  done
}

require_preconditions() {
  [[ "${INTEXURAOS_ENVIRONMENT:-}" == 'prod' ]] || fail 'Refusing to load secrets unless INTEXURAOS_ENVIRONMENT=prod'
  [[ "${SECRET_PACKAGE_VERSION}" =~ ^[1-9][0-9]*$ ]] || fail 'SECRET_PACKAGE_VERSION must be an exact positive numeric version'
  [[ "${PROJECT_ID}" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || fail 'Invalid GCP project ID'
  [[ "${SKIP_OWNERSHIP}" =~ ^[01]$ ]] || fail 'SKIP_OWNERSHIP must be 0 or 1'
  [[ "${SKIP_RUNTIME_CREDENTIAL_SMOKE}" =~ ^[01]$ ]] || fail 'SKIP_RUNTIME_CREDENTIAL_SMOKE must be 0 or 1'
  [[ "${SKIP_CLOUDFLARE_CREDENTIAL_SMOKE}" =~ ^[01]$ ]] || fail 'SKIP_CLOUDFLARE_CREDENTIAL_SMOKE must be 0 or 1'
  if [[ ! "${SECRET_PACKAGE_FETCH_TIMEOUT_SECONDS}" =~ ^[1-9][0-9]{0,2}$ ]] || (( SECRET_PACKAGE_FETCH_TIMEOUT_SECONDS > 120 )); then
    fail 'SECRET_PACKAGE_FETCH_TIMEOUT_SECONDS must be between 1 and 120'
  fi
  if [[ ! "${SECRET_PACKAGE_LOCK_TIMEOUT_SECONDS}" =~ ^[1-9][0-9]{0,2}$ ]] || (( SECRET_PACKAGE_LOCK_TIMEOUT_SECONDS > 300 )); then
    fail 'SECRET_PACKAGE_LOCK_TIMEOUT_SECONDS must be between 1 and 300'
  fi
  [[ "${SECRET_PACKAGE_RENDER_DIR}" == /* && "${SECRET_PACKAGE_RENDER_DIR}" != '/' ]] || fail 'Render root must be a narrow absolute directory'
  [[ "${SECRET_PROJECTION_ROOT}" == /* && "${SECRET_PROJECTION_ROOT}" != '/' ]] || fail 'Projection root must be a narrow absolute directory'
  command -v node >/dev/null 2>&1 || fail 'node is required'
  command -v install >/dev/null 2>&1 || fail 'install is required'
  if [[ "${SKIP_OWNERSHIP}" != '1' ]]; then
    [[ "${EUID}" -eq 0 ]] || fail 'Production secret publication must run as root'
    command -v flock >/dev/null 2>&1 || fail 'flock is required'
    id -u "${DEPLOY_USER}" >/dev/null 2>&1 || fail "Deploy user ${DEPLOY_USER} is required"
    getent group "${DEPLOY_GROUP}" >/dev/null 2>&1 || fail "Group ${DEPLOY_GROUP} is required"
    getent group "${NGINX_TOKEN_GROUP}" >/dev/null 2>&1 || fail "Group ${NGINX_TOKEN_GROUP} is required"
  fi
  if [[ -n "${SECRET_PACKAGE_PAYLOAD_FILE}" ]]; then
    [[ -r "${SECRET_PACKAGE_PAYLOAD_FILE}" ]] || fail 'Offline payload is unreadable'
  else
    command -v gcloud >/dev/null 2>&1 || fail 'gcloud is required'
    command -v timeout >/dev/null 2>&1 || fail 'timeout is required'
  fi
}

acquire_lock() {
  install -d -m 700 "$(dirname "${SECRET_PACKAGE_LOCK_FILE}")"
  : > "${SECRET_PACKAGE_LOCK_FILE}"
  chmod 600 "${SECRET_PACKAGE_LOCK_FILE}"
  if command -v flock >/dev/null 2>&1; then
    exec {HOST_LOCK_FD}<>"${SECRET_PACKAGE_LOCK_FILE}"
    flock --exclusive --wait "${SECRET_PACKAGE_LOCK_TIMEOUT_SECONDS}" "${HOST_LOCK_FD}" || fail 'Timed out waiting for production package lock'
    return
  fi
  [[ "${SKIP_OWNERSHIP}" == '1' ]] || fail 'flock is required'
  PORTABLE_LOCK_DIR="${SECRET_PACKAGE_LOCK_FILE}.portable"
  local deadline=$((SECONDS + SECRET_PACKAGE_LOCK_TIMEOUT_SECONDS))
  while ! mkdir -m 700 "${PORTABLE_LOCK_DIR}" 2>/dev/null; do
    (( SECONDS < deadline )) || fail 'Timed out waiting for production package lock'
    sleep 0.05
  done
}

render_package() {
  local args=(
    "${SECRET_PACKAGE_CLI}" render
    --environment prod
    --version "${SECRET_PACKAGE_VERSION}"
    --project-id "${PROJECT_ID}"
    --output-dir "${SECRET_PACKAGE_RENDER_DIR}"
  )
  if [[ -n "${SECRET_PACKAGE_PAYLOAD_FILE}" ]]; then
    args+=(--payload-file "${SECRET_PACKAGE_PAYLOAD_FILE}")
    node "${args[@]}" >/dev/null || fail 'Unable to render PROD package'
  else
    [[ -r "${PROVISIONER_SA_KEY_FILE}" ]] || fail 'Provisioner credential is unavailable'
    export CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="${PROVISIONER_SA_KEY_FILE}"
    timeout --signal=TERM --kill-after=5 "${SECRET_PACKAGE_FETCH_TIMEOUT_SECONDS}" \
      node "${args[@]}" >/dev/null || fail 'Unable to fetch and render PROD package'
  fi
  [[ -L "${SECRET_PACKAGE_RENDER_DIR}/current" ]] || fail 'Rendered package pointer is missing'
  PACKAGE_RELEASE_DIR="$(cd "${SECRET_PACKAGE_RENDER_DIR}/current" && pwd -P)"
}

validate_rendered_package() {
  if ! node --input-type=module - "${PACKAGE_RELEASE_DIR}" "${SECRET_PACKAGE_VERSION}" "${PROJECT_ID}" "${EXPECTED_RUNTIME_SA_EMAIL}" <<'NODE'
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const [releaseDir, expectedVersion, expectedProject, expectedEmail] = process.argv.slice(2);
const files = [
  'environment.env',
  'metadata.json',
  'runtime-gcp-service-account.json',
  'cloudflare-dns-api-token',
  'tls-private-key.pem',
];
for (const file of files) {
  const status = statSync(join(releaseDir, file));
  if (!status.isFile() || (status.mode & 0o7777) !== 0o600) process.exit(1);
}
const metadata = JSON.parse(readFileSync(join(releaseDir, 'metadata.json'), 'utf8'));
if (
  metadata.environment !== 'prod' ||
  metadata.secretId !== 'INTEXURAOS_SECRET_PACKAGE_PROD' ||
  metadata.version !== expectedVersion ||
  metadata.serviceAccount?.projectId !== expectedProject ||
  metadata.serviceAccount?.clientEmail !== expectedEmail
) process.exit(1);
NODE
  then
    fail 'Rendered PROD package does not match the deployment boundary'
  fi
}

write_candidate() {
  STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/intexuraos-prod-secrets.XXXXXX")"
  chmod 700 "${STAGING_DIR}"
  local tracked="${STAGING_DIR}/tracked.env"
  node "${RUNTIME_CONFIG_RENDERER}" --environment prod --format dotenv > "${tracked}" || fail 'Unable to render tracked production configuration'
  chmod 600 "${tracked}"

  {
    cat <<HEADER
# Generated from one exact PROD package. Do not edit.
INTEXURAOS_ENVIRONMENT="prod"
INTEXURAOS_RUNTIME="prod"
INTEXURAOS_SECRET_PACKAGE_VERSION="${SECRET_PACKAGE_VERSION}"
INTEXURAOS_GCP_PROJECT_ID="${PROJECT_ID}"
GOOGLE_CLOUD_PROJECT="${PROJECT_ID}"
PROJECT_ID="${PROJECT_ID}"
REGION="${REGION}"
HETZNER_PROVISIONER_GOOGLE_APPLICATION_CREDENTIALS="${PROVISIONER_SA_KEY_FILE}"
GOOGLE_APPLICATION_CREDENTIALS="${RUNTIME_SA_KEY_FILE}"
INTEXURAOS_PUBLIC_ORIGIN="${PUBLIC_ORIGIN}"
INTEXURAOS_WEB_APP_URL="${PUBLIC_ORIGIN}"
INTEXURAOS_WEB_URL="${PUBLIC_ORIGIN}"
INTEXURAOS_CODE_TASK_CALLBACK_BASE_URL="${PUBLIC_ORIGIN}/api/code"
INTEXURAOS_SENTRY_CODE_TASK_REPOSITORY="pbuchman/intexuraos"
INTEXURAOS_SENTRY_CODE_TASK_BASE_BRANCH="development"
NODE_ENV="production"

HEADER
    cat "${tracked}"
    printf '\n'
    cat "${PACKAGE_RELEASE_DIR}/environment.env"
  } > "${STAGING_DIR}/.env.prod"
  chmod 600 "${STAGING_DIR}/.env.prod"
  local duplicates
  duplicates="$(awk -F= '/^[A-Z][A-Z0-9_]*=/{print $1}' "${STAGING_DIR}/.env.prod" | sort | uniq -d)"
  [[ -z "${duplicates}" ]] || fail 'Merged production environment contains duplicate names'

  install -m 600 "${PACKAGE_RELEASE_DIR}/runtime-gcp-service-account.json" \
    "${STAGING_DIR}/runtime-sa-key.json"
  install -m 600 "${PACKAGE_RELEASE_DIR}/tls-private-key.pem" "${STAGING_DIR}/tls-private-key.pem"
  install -m 600 "${PACKAGE_RELEASE_DIR}/metadata.json" "${STAGING_DIR}/metadata.json"
  if ! node --input-type=module - "${PACKAGE_RELEASE_DIR}/environment.env" "${STAGING_DIR}/internal-auth-token" <<'NODE'
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'dotenv';
const [source, target] = process.argv.slice(2);
const value = parse(readFileSync(source, 'utf8')).INTEXURAOS_INTERNAL_AUTH_TOKEN;
if (typeof value !== 'string' || value.length === 0) process.exit(1);
writeFileSync(target, value, { mode: 0o600 });
chmodSync(target, 0o600);
NODE
  then
    fail 'Internal auth token is missing from the package'
  fi
  if ! node --input-type=module - "${PACKAGE_RELEASE_DIR}/cloudflare-dns-api-token" "${STAGING_DIR}/cloudflare.ini" <<'NODE'
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
const [source, target] = process.argv.slice(2);
const token = readFileSync(source, 'utf8');
if (token.length === 0 || token.trim() !== token || /[\r\n\0]/u.test(token)) process.exit(1);
writeFileSync(target, `dns_cloudflare_api_token = ${token}\n`, { mode: 0o600 });
chmodSync(target, 0o600);
NODE
  then
    fail 'Cloudflare DNS token is malformed'
  fi

  PROJECT_ID="${PROJECT_ID}" SKIP_RUNTIME_CREDENTIAL_SMOKE="${SKIP_RUNTIME_CREDENTIAL_SMOKE}" SKIP_CLOUDFLARE_CREDENTIAL_SMOKE="${SKIP_CLOUDFLARE_CREDENTIAL_SMOKE}" INTEXURAOS_ENVIRONMENT=prod bash "${PROD_CANDIDATE_VALIDATOR}" --runtime-credential "${STAGING_DIR}/runtime-sa-key.json" --cloudflare-credentials "${STAGING_DIR}/cloudflare.ini" --package-version "${SECRET_PACKAGE_VERSION}" >/dev/null || fail 'PROD candidate credential validation failed'
}

publish_file() {
  local source="$1"
  local target="$2"
  local mode="$3"
  local owner="$4"
  local group="$5"
  local parent
  local temporary
  parent="$(dirname "${target}")"
  install -d -m 755 "${parent}"
  temporary="$(mktemp "${parent}/.$(basename "${target}").next.XXXXXX")"
  install -m "${mode}" "${source}" "${temporary}"
  if [[ "${SKIP_OWNERSHIP}" != '1' ]]; then
    chown "${owner}:${group}" "${temporary}"
  fi
  mv -f -- "${temporary}" "${target}"
}

publish_candidate() {
  publish_file "${STAGING_DIR}/runtime-sa-key.json" "${RUNTIME_SA_KEY_FILE}" 600 \
    "${DEPLOY_USER}" "${DEPLOY_GROUP}"
  publish_file "${STAGING_DIR}/internal-auth-token" "${INTERNAL_AUTH_TOKEN_FILE}" 640 \
    root "${NGINX_TOKEN_GROUP}"
  publish_file "${STAGING_DIR}/cloudflare.ini" "${CLOUDFLARE_CREDENTIALS_FILE}" 600 root root
  publish_file "${STAGING_DIR}/tls-private-key.pem" "${TLS_PRIVATE_KEY_FILE}" 600 root root
  publish_file "${STAGING_DIR}/metadata.json" "${PACKAGE_METADATA_FILE}" 600 root root
  publish_file "${STAGING_DIR}/.env.prod" "${OUTPUT_FILE}" 600 \
    "${DEPLOY_USER}" "${DEPLOY_GROUP}"
}

delete_local_rollback_state() {
  rm -rf -- "${SECRET_PROJECTION_ROOT}"
  if ! node --input-type=module - "${SECRET_PACKAGE_RENDER_DIR}" <<'NODE'
import { lstatSync, readdirSync, readlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
const root = process.argv[2];
const current = readlinkSync(join(root, 'current'));
if (!/^prod-v[1-9][0-9]*-[0-9a-f]{8}$/u.test(current)) process.exit(1);
for (const name of readdirSync(root)) {
  if (name === 'current' || name === current) continue;
  const path = join(root, name);
  const status = lstatSync(path);
  if (!status.isDirectory() || status.isSymbolicLink()) process.exit(1);
  rmSync(path, { recursive: true });
}
NODE
  then
    fail 'Unable to delete obsolete local package renders'
  fi
}

main() {
  parse_args "$@"
  require_preconditions
  umask 077
  acquire_lock
  render_package
  validate_rendered_package
  write_candidate
  publish_candidate
  delete_local_rollback_state
  printf 'Activated PROD secret package version %s with no rollback release\n' \
    "${SECRET_PACKAGE_VERSION}"
}

main "$@"
