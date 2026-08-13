#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SECRET_PACKAGE_CLI="${REPO_ROOT}/scripts/secret-package.mjs"
RUNTIME_CONFIG_RENDERER="${REPO_ROOT}/scripts/render-runtime-config.mjs"
PROJECT_ID="${PROJECT_ID:-intexuraos-dev-pbuchman}"
REGION="${REGION:-europe-central2}"
SECRET_PACKAGE_VERSION="${SECRET_PACKAGE_VERSION:-}"
SECRET_PACKAGE_RENDER_DIR="${SECRET_PACKAGE_RENDER_DIR:-/var/lib/intexuraos/secret-packages/prod}"
SECRET_PROJECTION_ROOT="${SECRET_PROJECTION_ROOT:-/var/lib/intexuraos/secret-projections/prod}"
SECRET_PACKAGE_PAYLOAD_FILE="${SECRET_PACKAGE_PAYLOAD_FILE:-}"
INTEXURAOS_COMMIT_SHA="${INTEXURAOS_COMMIT_SHA:-}"
OUTPUT_FILE="${OUTPUT_FILE:-/etc/intexuraos/.env.prod}"
PROVISIONER_SA_KEY_FILE="${PROVISIONER_SA_KEY_FILE:-${GOOGLE_APPLICATION_CREDENTIALS:-/home/deploy/provisioner-sa-key.json}}"
RUNTIME_SA_KEY_FILE="${RUNTIME_SA_KEY_FILE:-/home/deploy/runtime-sa-key.json}"
INTERNAL_AUTH_TOKEN_FILE="${INTERNAL_AUTH_TOKEN_FILE:-/etc/intexuraos/internal-auth-token}"
CLOUDFLARE_CREDENTIALS_FILE="${CLOUDFLARE_CREDENTIALS_FILE:-/etc/letsencrypt/cloudflare.ini}"
TLS_PRIVATE_KEY_FILE="${TLS_PRIVATE_KEY_FILE:-/etc/intexuraos/tls-private-key.pem}"
PUBLIC_ORIGIN="${PUBLIC_ORIGIN:-https://intexuraos.cloud}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
DEPLOY_GROUP="${DEPLOY_GROUP:-${DEPLOY_USER}}"
NGINX_TOKEN_GROUP="${NGINX_TOKEN_GROUP:-www-data}"
EXPECTED_RUNTIME_SA_EMAIL="${EXPECTED_RUNTIME_SA_EMAIL:-}"
SKIP_RUNTIME_CREDENTIAL_SMOKE="${SKIP_RUNTIME_CREDENTIAL_SMOKE:-0}"
SKIP_OWNERSHIP="${SKIP_OWNERSHIP:-0}"
STAGING_DIR=""
TEMP_LINKS=()
OPERATION="stage-and-activate"
REQUESTED_RELEASE_NAME=""
PACKAGE_RELEASE_DIR=""
PACKAGE_RELEASE_NAME=""
STAGED_PROJECTION_RELEASE_NAME=""
PREVIOUS_PROJECTION_RELEASE_NAME=""

usage() {
  cat <<EOF
Usage:
  INTEXURAOS_ENVIRONMENT=prod INTEXURAOS_COMMIT_SHA=<sha> $(basename "$0") --version <n> [--stage-only] [options]
  INTEXURAOS_ENVIRONMENT=prod $(basename "$0") --preflight <release-name> [options]
  INTEXURAOS_ENVIRONMENT=prod $(basename "$0") --activate <release-name> [options]
  INTEXURAOS_ENVIRONMENT=prod $(basename "$0") --rollback <release-name> [options]
  INTEXURAOS_ENVIRONMENT=prod $(basename "$0") --current-release [options]

Options:
  --version <n>                    Exact PROD Secret Manager package version
  --stage-only                     Persist and preflight an immutable candidate without activation
  --preflight <release-name>       Revalidate an existing candidate without changing stable links
  --activate <release-name>        Atomically activate one existing complete projection
  --rollback <release-name>        Alias for safe activation of a prior complete projection
  --current-release                Print the active projection name, or legacy-pre-packages
  --project-id <id>                GCP project (default: ${PROJECT_ID})
  --output <path>                  Stable production dotenv path
  --render-dir <path>              Private immutable package render root
  --projection-dir <path>          Transactional runtime projection root
  --payload-file <path>            Offline/test payload; never use for normal deployment
  -h, --help                       Show this help

SECRET_PACKAGE_VERSION may be used instead of --version. Mutable aliases such as latest are rejected.
EOF
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

cleanup() {
  if [[ -n "${STAGING_DIR}" && -d "${STAGING_DIR}" ]]; then
    rm -rf -- "${STAGING_DIR}"
  fi
  local temporary_link=""
  for temporary_link in "${TEMP_LINKS[@]}"; do
    [[ -L "${temporary_link}" ]] && rm -f -- "${temporary_link}"
  done
}

trap cleanup EXIT

select_operation() {
  local operation="$1"
  local release_name="${2:-}"
  if [[ "${OPERATION}" != 'stage-and-activate' ]]; then
    fail 'Choose exactly one loader operation'
  fi
  OPERATION="${operation}"
  REQUESTED_RELEASE_NAME="${release_name}"
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --version)
        shift
        [[ $# -gt 0 ]] || fail '--version requires a value'
        SECRET_PACKAGE_VERSION="$1"
        shift
        ;;
      --version=*) SECRET_PACKAGE_VERSION="${1#*=}"; shift ;;
      --project-id)
        shift
        [[ $# -gt 0 ]] || fail '--project-id requires a value'
        PROJECT_ID="$1"
        shift
        ;;
      --project-id=*) PROJECT_ID="${1#*=}"; shift ;;
      --output)
        shift
        [[ $# -gt 0 ]] || fail '--output requires a value'
        OUTPUT_FILE="$1"
        shift
        ;;
      --output=*) OUTPUT_FILE="${1#*=}"; shift ;;
      --render-dir)
        shift
        [[ $# -gt 0 ]] || fail '--render-dir requires a value'
        SECRET_PACKAGE_RENDER_DIR="$1"
        shift
        ;;
      --render-dir=*) SECRET_PACKAGE_RENDER_DIR="${1#*=}"; shift ;;
      --projection-dir)
        shift
        [[ $# -gt 0 ]] || fail '--projection-dir requires a value'
        SECRET_PROJECTION_ROOT="$1"
        shift
        ;;
      --projection-dir=*) SECRET_PROJECTION_ROOT="${1#*=}"; shift ;;
      --payload-file)
        shift
        [[ $# -gt 0 ]] || fail '--payload-file requires a value'
        SECRET_PACKAGE_PAYLOAD_FILE="$1"
        shift
        ;;
      --payload-file=*) SECRET_PACKAGE_PAYLOAD_FILE="${1#*=}"; shift ;;
      --stage-only)
        select_operation 'stage-only'
        shift
        ;;
      --preflight|--activate|--rollback)
        local operation="${1#--}"
        shift
        [[ $# -gt 0 ]] || fail "--${operation} requires a release name"
        select_operation "${operation}" "$1"
        shift
        ;;
      --preflight=*|--activate=*|--rollback=*)
        local option="${1%%=*}"
        select_operation "${option#--}" "${1#*=}"
        shift
        ;;
      --current-release)
        select_operation 'current-release'
        shift
        ;;
      -h|--help) usage; exit 0 ;;
      *) fail "Unknown argument: $1" ;;
    esac
  done
}

require_preconditions() {
  [[ "${INTEXURAOS_ENVIRONMENT:-}" == 'prod' ]] \
    || fail 'Refusing to load secrets unless INTEXURAOS_ENVIRONMENT=prod'
  [[ "${PROJECT_ID}" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || fail 'Invalid GCP project ID'
  [[ "${SKIP_RUNTIME_CREDENTIAL_SMOKE}" =~ ^[01]$ ]] \
    || fail 'SKIP_RUNTIME_CREDENTIAL_SMOKE must be 0 or 1'
  [[ "${SKIP_OWNERSHIP}" =~ ^[01]$ ]] || fail 'SKIP_OWNERSHIP must be 0 or 1'
  if [[ -z "${EXPECTED_RUNTIME_SA_EMAIL}" ]]; then
    EXPECTED_RUNTIME_SA_EMAIL="ixos-hetzner-runtime-dev@${PROJECT_ID}.iam.gserviceaccount.com"
  fi
  command -v node >/dev/null 2>&1 || fail 'node is required'
  command -v install >/dev/null 2>&1 || fail 'install is required'
  if [[ "${OPERATION}" != 'current-release' && "${SKIP_OWNERSHIP}" != '1' ]]; then
    id -u "${DEPLOY_USER}" >/dev/null 2>&1 || fail "Deploy user ${DEPLOY_USER} is required"
    command -v getent >/dev/null 2>&1 || fail 'getent is required'
    getent group "${NGINX_TOKEN_GROUP}" >/dev/null 2>&1 \
      || fail "Group ${NGINX_TOKEN_GROUP} is required"
  fi
  case "${OPERATION}" in
    stage-and-activate|stage-only)
      [[ "${SECRET_PACKAGE_VERSION}" =~ ^[1-9][0-9]*$ ]] \
        || fail 'SECRET_PACKAGE_VERSION must be an exact positive numeric version'
      [[ "${INTEXURAOS_COMMIT_SHA}" =~ ^[0-9a-f]{40}$ ]] \
        || fail 'INTEXURAOS_COMMIT_SHA must be a 40-character lowercase hexadecimal SHA'
      [[ -f "${SECRET_PACKAGE_CLI}" ]] || fail 'Secret package CLI is unavailable'
      [[ -f "${RUNTIME_CONFIG_RENDERER}" ]] || fail 'Runtime config renderer is unavailable'
      if [[ -z "${SECRET_PACKAGE_PAYLOAD_FILE}" ]]; then
        command -v gcloud >/dev/null 2>&1 || fail 'gcloud is required for package fetch'
      else
        [[ -r "${SECRET_PACKAGE_PAYLOAD_FILE}" ]] || fail 'Offline payload file is unreadable'
      fi
      ;;
    preflight|activate|rollback)
      validate_release_name "${REQUESTED_RELEASE_NAME}"
      ;;
    current-release) ;;
    *) fail 'Unsupported loader operation' ;;
  esac
}

render_package() {
  local arguments=(
    "${SECRET_PACKAGE_CLI}" render
    --environment prod
    --version "${SECRET_PACKAGE_VERSION}"
    --project-id "${PROJECT_ID}"
    --output-dir "${SECRET_PACKAGE_RENDER_DIR}"
  )
  if [[ -n "${SECRET_PACKAGE_PAYLOAD_FILE}" ]]; then
    arguments+=(--payload-file "${SECRET_PACKAGE_PAYLOAD_FILE}")
  elif [[ -r "${PROVISIONER_SA_KEY_FILE}" ]]; then
    export CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="${PROVISIONER_SA_KEY_FILE}"
  fi

  node "${arguments[@]}" >/dev/null || fail 'Unable to fetch, verify, and render PROD package'
}

validate_rendered_package() {
  local current_path="${SECRET_PACKAGE_RENDER_DIR}/current"
  [[ -L "${current_path}" ]] || fail 'Rendered package current pointer is unavailable'
  PACKAGE_RELEASE_DIR="$(cd "${current_path}" && pwd -P)"
  PACKAGE_RELEASE_NAME="$(basename "${PACKAGE_RELEASE_DIR}")"
  if ! node --input-type=module - \
    "${PACKAGE_RELEASE_DIR}" \
    "${PACKAGE_RELEASE_DIR}/metadata.json" \
    "${SECRET_PACKAGE_VERSION}" \
    "${PROJECT_ID}" \
    "${EXPECTED_RUNTIME_SA_EMAIL}" <<'NODE'
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const [releaseDir, metadataPath, expectedVersion, expectedProject, expectedEmail] = process.argv.slice(2);
const requiredFiles = [
  'environment.env',
  'metadata.json',
  'runtime-gcp-service-account.json',
  'cloudflare-dns-api-token',
  'tls-private-key.pem',
];
for (const file of requiredFiles) {
  let status;
  try { status = statSync(join(releaseDir, file)); } catch { process.exit(9); }
  if (!status.isFile() || (status.mode & 0o777) !== 0o600) process.exit(9);
}
let metadata;
try { metadata = JSON.parse(readFileSync(metadataPath, 'utf8')); } catch { process.exit(10); }
if (
  metadata.environment !== 'prod' ||
  metadata.secretId !== 'INTEXURAOS_SECRET_PACKAGE_PROD' ||
  metadata.version !== expectedVersion ||
  metadata.serviceAccount?.projectId !== expectedProject ||
  metadata.serviceAccount?.clientEmail !== expectedEmail
) process.exit(11);
NODE
  then
    fail 'Rendered PROD package files or metadata do not match the deployment boundary'
  fi
}

write_projection_environment() {
  local package_env="$1"
  local tracked_env="$2"
  local target="$3"

  {
    cat <<HEADER
# Generated by scripts/hetzner/load-secrets.sh from one immutable PROD package.
# Do not edit by hand.
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

# Tracked non-secret runtime configuration.
HEADER
    cat "${tracked_env}"
    printf '\n# Secret package environment projection.\n'
    cat "${package_env}"
  } > "${target}"
  chmod 600 "${target}"

  local duplicate_names=""
  duplicate_names="$(awk -F= '/^[A-Z][A-Z0-9_]*=/{print $1}' "${target}" | sort | uniq -d)"
  [[ -z "${duplicate_names}" ]] || fail 'Merged production environment contains duplicate names'
}

extract_internal_auth_token() {
  local package_env="$1"
  local target="$2"
  node --input-type=module - "${package_env}" "${target}" <<'NODE'
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'dotenv';
const [source, target] = process.argv.slice(2);
let value;
try { value = parse(readFileSync(source, 'utf8')).INTEXURAOS_INTERNAL_AUTH_TOKEN; }
catch { process.exit(21); }
if (typeof value !== 'string' || value.length === 0) process.exit(22);
writeFileSync(target, value, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
chmodSync(target, 0o600);
NODE
}

write_cloudflare_credentials() {
  local token_path="$1"
  local target="$2"
  node --input-type=module - "${token_path}" "${target}" <<'NODE'
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
const [source, target] = process.argv.slice(2);
const token = readFileSync(source, 'utf8');
if (token.length === 0 || token.trim() !== token || /[\r\n\0]/u.test(token)) process.exit(30);
writeFileSync(target, `dns_cloudflare_api_token = ${token}\n`, {
  encoding: 'utf8', flag: 'wx', mode: 0o600,
});
chmodSync(target, 0o600);
NODE
}

validate_runtime_credential() {
  local credential_path="$1"
  [[ "${SKIP_RUNTIME_CREDENTIAL_SMOKE}" == '1' ]] && return 0
  command -v gcloud >/dev/null 2>&1 || fail 'gcloud is required for runtime credential smoke test'
  command -v curl >/dev/null 2>&1 || fail 'curl is required for Firestore credential smoke test'

  local access_token=""
  access_token="$(CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="${credential_path}" \
    gcloud auth print-access-token --quiet 2>/dev/null)" \
    || fail 'Runtime service-account token smoke test failed'
  [[ -n "${access_token}" ]] || fail 'Runtime service-account token smoke test returned no token'
  curl --fail --silent --show-error --output /dev/null \
    --request POST \
    --header "Authorization: Bearer ${access_token}" \
    --header 'Content-Type: application/json' \
    --data '{"pageSize":1}' \
    "https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:listCollectionIds" \
    || fail 'Runtime service-account Firestore smoke test failed'
  unset access_token
}

stage_projection() {
  install -d -m 711 "${SECRET_PROJECTION_ROOT}"
  STAGING_DIR="$(mktemp -d "${SECRET_PROJECTION_ROOT}/.staging.XXXXXX")"
  chmod 711 "${STAGING_DIR}"
  local tracked_env="${STAGING_DIR}/tracked.env"
  node "${RUNTIME_CONFIG_RENDERER}" --environment prod --format dotenv > "${tracked_env}" \
    || fail 'Unable to render tracked production configuration'
  chmod 600 "${tracked_env}"

  write_projection_environment \
    "${PACKAGE_RELEASE_DIR}/environment.env" "${tracked_env}" "${STAGING_DIR}/.env.prod"
  rm -f -- "${tracked_env}"
  install -m 600 "${PACKAGE_RELEASE_DIR}/runtime-gcp-service-account.json" \
    "${STAGING_DIR}/runtime-sa-key.json"
  extract_internal_auth_token "${PACKAGE_RELEASE_DIR}/environment.env" \
    "${STAGING_DIR}/internal-auth-token"
  write_cloudflare_credentials "${PACKAGE_RELEASE_DIR}/cloudflare-dns-api-token" \
    "${STAGING_DIR}/cloudflare.ini"
  install -m 600 "${PACKAGE_RELEASE_DIR}/tls-private-key.pem" "${STAGING_DIR}/tls-private-key.pem"
  install -m 600 "${PACKAGE_RELEASE_DIR}/metadata.json" "${STAGING_DIR}/metadata.json"

  validate_runtime_credential "${STAGING_DIR}/runtime-sa-key.json"

  if [[ "${SKIP_OWNERSHIP}" != '1' ]]; then
    chown "${DEPLOY_USER}:${DEPLOY_GROUP}" "${STAGING_DIR}/.env.prod" \
      "${STAGING_DIR}/runtime-sa-key.json"
    chown "root:${NGINX_TOKEN_GROUP}" "${STAGING_DIR}/internal-auth-token"
  fi
  chmod 640 "${STAGING_DIR}/internal-auth-token"
  chmod 600 "${STAGING_DIR}/.env.prod" "${STAGING_DIR}/runtime-sa-key.json" \
    "${STAGING_DIR}/cloudflare.ini" "${STAGING_DIR}/tls-private-key.pem" \
    "${STAGING_DIR}/metadata.json"
}

projection_matches_staging() {
  local release_dir="$1"
  local name=""
  [[ -d "${release_dir}" && ! -L "${release_dir}" ]] || return 1
  for name in .env.prod runtime-sa-key.json internal-auth-token cloudflare.ini tls-private-key.pem metadata.json; do
    [[ -f "${release_dir}/${name}" ]] || return 1
    cmp -s "${STAGING_DIR}/${name}" "${release_dir}/${name}" || return 1
  done
}

validate_release_name() {
  local release_name="$1"
  [[ "${release_name}" =~ ^(legacy-pre-packages|prod-v[1-9][0-9]*-[0-9a-f]{8}-[0-9a-f]{40})$ ]] \
    || fail 'Projection release name is invalid'
}

resolve_projection_release_dir() {
  local release_name="$1"
  validate_release_name "${release_name}"
  local release_dir="${SECRET_PROJECTION_ROOT}/${release_name}"
  [[ -d "${release_dir}" && ! -L "${release_dir}" ]] \
    || fail 'Projection release is unavailable'
  printf '%s' "${release_dir}"
}

validate_projection_release() {
  local release_name="$1"
  local release_dir=""
  local name=""
  release_dir="$(resolve_projection_release_dir "${release_name}")"
  for name in .env.prod runtime-sa-key.json internal-auth-token cloudflare.ini tls-private-key.pem metadata.json; do
    [[ -f "${release_dir}/${name}" && ! -L "${release_dir}/${name}" ]] \
      || fail 'Projection release is incomplete'
  done
  node --input-type=module - "${release_dir}" "${PROJECT_ID}" "${EXPECTED_RUNTIME_SA_EMAIL}" <<'NODE'
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const [releaseDir, expectedProject, expectedEmail] = process.argv.slice(2);
const expectedModes = new Map([
  ['.env.prod', 0o600],
  ['runtime-sa-key.json', 0o600],
  ['internal-auth-token', 0o640],
  ['cloudflare.ini', 0o600],
  ['tls-private-key.pem', 0o600],
  ['metadata.json', 0o600],
]);
for (const [name, expectedMode] of expectedModes) {
  if ((statSync(join(releaseDir, name)).mode & 0o777) !== expectedMode) process.exit(41);
}
const metadata = JSON.parse(readFileSync(join(releaseDir, 'metadata.json'), 'utf8'));
if (
  metadata.environment !== 'prod' ||
  metadata.secretId !== 'INTEXURAOS_SECRET_PACKAGE_PROD' ||
  !/^[1-9][0-9]*$/u.test(metadata.version) ||
  metadata.serviceAccount?.projectId !== expectedProject ||
  metadata.serviceAccount?.clientEmail !== expectedEmail
) process.exit(42);
NODE
  validate_runtime_credential "${release_dir}/runtime-sa-key.json"
}

preserve_legacy_files() {
  local fallback_dir="$1"
  [[ ! -e "${SECRET_PROJECTION_ROOT}/current" && ! -L "${SECRET_PROJECTION_ROOT}/current" ]] \
    || return 0
  local backup_dir="${SECRET_PROJECTION_ROOT}/legacy-pre-packages"
  local source=""
  local name=""
  local file_mode=""
  install -d -m 700 "${backup_dir}"
  while IFS='|' read -r source name file_mode; do
    if [[ -f "${source}" && ! -L "${source}" && ! -e "${backup_dir}/${name}" ]]; then
      install -m "${file_mode}" "${source}" "${backup_dir}/${name}"
    elif [[ ! -e "${backup_dir}/${name}" ]]; then
      install -m "${file_mode}" "${fallback_dir}/${name}" "${backup_dir}/${name}"
    fi
  done <<EOF
${OUTPUT_FILE}|.env.prod|600
${RUNTIME_SA_KEY_FILE}|runtime-sa-key.json|600
${INTERNAL_AUTH_TOKEN_FILE}|internal-auth-token|640
${CLOUDFLARE_CREDENTIALS_FILE}|cloudflare.ini|600
${TLS_PRIVATE_KEY_FILE}|tls-private-key.pem|600
EOF
  install -m 600 "${fallback_dir}/metadata.json" "${backup_dir}/metadata.json"
  if [[ "${SKIP_OWNERSHIP}" != '1' ]]; then
    chown "${DEPLOY_USER}:${DEPLOY_GROUP}" "${backup_dir}/.env.prod" \
      "${backup_dir}/runtime-sa-key.json"
    chown "root:${NGINX_TOKEN_GROUP}" "${backup_dir}/internal-auth-token"
  fi
}

activate_current_projection() {
  local release_name="$1"
  local current_path="${SECRET_PROJECTION_ROOT}/current"
  node --input-type=module - "${current_path}" "${release_name}" <<'NODE'
import { randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, openSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import { dirname } from 'node:path';
const [currentPath, releaseName] = process.argv.slice(2);
const temporary = `${currentPath}.package-${process.pid}-${randomUUID()}.tmp`;
try {
  symlinkSync(releaseName, temporary, 'dir');
  renameSync(temporary, currentPath);
  const descriptor = openSync(dirname(currentPath), 'r');
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
} catch (error) {
  rmSync(temporary, { force: true });
  throw error;
}
NODE
}

publish_projection_links() {
  local marker_path="${SECRET_PROJECTION_ROOT}/.stable-link-transaction.json"
  if ! node --input-type=module - \
    "${marker_path}" \
    "${OUTPUT_FILE}" "${SECRET_PROJECTION_ROOT}/current/.env.prod" \
    "${RUNTIME_SA_KEY_FILE}" "${SECRET_PROJECTION_ROOT}/current/runtime-sa-key.json" \
    "${INTERNAL_AUTH_TOKEN_FILE}" "${SECRET_PROJECTION_ROOT}/current/internal-auth-token" \
    "${CLOUDFLARE_CREDENTIALS_FILE}" "${SECRET_PROJECTION_ROOT}/current/cloudflare.ini" \
    "${TLS_PRIVATE_KEY_FILE}" "${SECRET_PROJECTION_ROOT}/current/tls-private-key.pem" <<'NODE'
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute } from 'node:path';

const [markerPath, ...pairValues] = process.argv.slice(2);
const expected = [];
for (let index = 0; index < pairValues.length; index += 2) {
  expected.push({ path: pairValues[index], target: pairValues[index + 1] });
}

function statusOrUndefined(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return undefined;
    throw error;
  }
}

function removeNonDirectory(path) {
  const status = statusOrUndefined(path);
  if (status === undefined) return;
  if (status.isDirectory() && !status.isSymbolicLink()) throw new Error('unsafe transaction path');
  rmSync(path, { force: true });
}

function syncDirectory(path) {
  const descriptor = openSync(path, 'r');
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function syncStableParents() {
  for (const parent of new Set(expected.map((entry) => dirname(entry.path)))) {
    syncDirectory(parent);
  }
}

function validateEntry(entry, expectedEntry) {
  if (
    entry === null ||
    typeof entry !== 'object' ||
    entry.path !== expectedEntry.path ||
    entry.target !== expectedEntry.target ||
    typeof entry.backup !== 'string' ||
    typeof entry.temporary !== 'string' ||
    dirname(entry.backup) !== dirname(entry.path) ||
    dirname(entry.temporary) !== dirname(entry.path) ||
    !entry.backup.startsWith(`${entry.path}.package-backup-`) ||
    !entry.temporary.startsWith(`${entry.path}.package-next-`) ||
    typeof entry.hadOriginal !== 'boolean' ||
    typeof entry.skip !== 'boolean'
  ) {
    throw new Error('invalid transaction marker');
  }
  return entry;
}

function readMarker() {
  const markerStatus = statusOrUndefined(markerPath);
  if (markerStatus === undefined) return undefined;
  if (
    !markerStatus.isFile() ||
    markerStatus.isSymbolicLink() ||
    (markerStatus.mode & 0o777) !== 0o600
  ) {
    throw new Error('unsafe transaction marker');
  }
  const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
  if (
    marker?.schemaVersion !== 1 ||
    !Array.isArray(marker.entries) ||
    marker.entries.length !== expected.length
  ) {
    throw new Error('invalid transaction marker');
  }
  return marker.entries.map((entry, index) => validateEntry(entry, expected[index]));
}

function restore(entries) {
  for (const entry of [...entries].reverse()) {
    removeNonDirectory(entry.temporary);
    if (entry.skip) continue;
    const backupStatus = statusOrUndefined(entry.backup);
    if (backupStatus !== undefined) {
      if (backupStatus.isDirectory() && !backupStatus.isSymbolicLink()) {
        throw new Error('unsafe transaction backup');
      }
      removeNonDirectory(entry.path);
      renameSync(entry.backup, entry.path);
      continue;
    }
    if (entry.hadOriginal) {
      const currentStatus = statusOrUndefined(entry.path);
      if (
        currentStatus === undefined ||
        (currentStatus.isSymbolicLink() && readlinkSync(entry.path) === entry.target)
      ) {
        throw new Error('transaction backup missing');
      }
      continue;
    }
    const currentStatus = statusOrUndefined(entry.path);
    if (currentStatus === undefined) continue;
    if (!currentStatus.isSymbolicLink() || readlinkSync(entry.path) !== entry.target) {
      throw new Error('unexpected transaction target');
    }
    removeNonDirectory(entry.path);
  }
  syncStableParents();
}

function removeMarker() {
  rmSync(markerPath, { force: true });
  syncDirectory(dirname(markerPath));
}

function recoverInterruptedTransaction() {
  const entries = readMarker();
  if (entries === undefined) return;
  restore(entries);
  removeMarker();
}

function writeMarker(entries) {
  const temporaryMarker = `${markerPath}.${process.pid}.${randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = openSync(temporaryMarker, 'wx', 0o600);
    writeFileSync(descriptor, `${JSON.stringify({ schemaVersion: 1, entries })}\n`);
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  chmodSync(temporaryMarker, 0o600);
  renameSync(temporaryMarker, markerPath);
  syncDirectory(dirname(markerPath));
}

function installLinks() {
  if (
    !isAbsolute(markerPath) ||
    expected.length !== 5 ||
    expected.some(
      (entry) =>
        typeof entry.path !== 'string' ||
        typeof entry.target !== 'string' ||
        !isAbsolute(entry.path) ||
        !isAbsolute(entry.target)
    )
  ) {
    throw new Error('invalid stable link transaction input');
  }
  recoverInterruptedTransaction();
  const entries = expected.map((entry) => {
    const originalStatus = statusOrUndefined(entry.path);
    if (originalStatus?.isDirectory() && !originalStatus.isSymbolicLink()) {
      throw new Error('stable path is a directory');
    }
    const skip = originalStatus?.isSymbolicLink() && readlinkSync(entry.path) === entry.target;
    return {
      ...entry,
      backup: `${entry.path}.package-backup-${process.pid}-${randomUUID()}`,
      temporary: `${entry.path}.package-next-${process.pid}-${randomUUID()}`,
      hadOriginal: originalStatus !== undefined,
      skip,
    };
  });
  writeMarker(entries);
  try {
    for (const entry of entries) {
      if (entry.skip) continue;
      mkdirSync(dirname(entry.path), { recursive: true, mode: 0o755 });
      chmodSync(dirname(entry.path), 0o755);
      if (entry.hadOriginal) renameSync(entry.path, entry.backup);
      symlinkSync(entry.target, entry.temporary);
      renameSync(entry.temporary, entry.path);
    }
    for (const entry of entries) {
      const status = lstatSync(entry.path);
      if (!status.isSymbolicLink() || readlinkSync(entry.path) !== entry.target) {
        throw new Error('stable link verification failed');
      }
    }
    syncStableParents();
    removeMarker();
    for (const entry of entries) rmSync(entry.backup, { force: true });
  } catch (error) {
    try {
      restore(entries);
      removeMarker();
    } catch {
      // Leave the root-owned marker for deterministic recovery on the next invocation.
    }
    throw error;
  }
}

try {
  installLinks();
} catch {
  process.exitCode = 1;
}
NODE
  then
    fail 'Stable production projection link transaction failed'
  fi
}

activate_projection_release() {
  local release_name="$1"
  validate_projection_release "${release_name}"
  if [[ ! -L "${SECRET_PROJECTION_ROOT}/current" ]]; then
    [[ ! -e "${SECRET_PROJECTION_ROOT}/current" ]] \
      || fail 'Active production projection pointer is invalid'
    [[ -d "${SECRET_PROJECTION_ROOT}/legacy-pre-packages" ]] \
      || fail 'Legacy production projection is unavailable'
    activate_current_projection 'legacy-pre-packages'
  fi
  publish_projection_links
  activate_current_projection "${release_name}"
}

print_current_release() {
  local current_path="${SECRET_PROJECTION_ROOT}/current"
  local release_name=""
  if [[ -L "${current_path}" ]]; then
    release_name="$(readlink "${current_path}")"
  elif [[ -d "${SECRET_PROJECTION_ROOT}/legacy-pre-packages" ]]; then
    release_name='legacy-pre-packages'
  else
    fail 'Active production projection is unavailable'
  fi
  validate_release_name "${release_name}"
  validate_projection_release "${release_name}"
  printf '%s\n' "${release_name}"
}

publish_projection() {
  local projection_release_name="${PACKAGE_RELEASE_NAME}-${INTEXURAOS_COMMIT_SHA}"
  local projection_release_dir="${SECRET_PROJECTION_ROOT}/${projection_release_name}"
  if [[ -L "${SECRET_PROJECTION_ROOT}/current" ]]; then
    PREVIOUS_PROJECTION_RELEASE_NAME="$(readlink "${SECRET_PROJECTION_ROOT}/current")"
    validate_release_name "${PREVIOUS_PROJECTION_RELEASE_NAME}"
  else
    PREVIOUS_PROJECTION_RELEASE_NAME='legacy-pre-packages'
  fi

  if [[ -e "${projection_release_dir}" ]]; then
    if projection_matches_staging "${projection_release_dir}"; then
      rm -rf -- "${STAGING_DIR}"
      STAGING_DIR=""
    else
      fail 'Existing immutable production projection does not match this package and commit'
    fi
  else
    mv "${STAGING_DIR}" "${projection_release_dir}"
    STAGING_DIR=""
  fi

  preserve_legacy_files "${projection_release_dir}"
  STAGED_PROJECTION_RELEASE_NAME="${projection_release_name}"
  validate_projection_release "${projection_release_name}"
}

report_activation() {
  local release_name="$1"
  printf 'Activated PROD secret projection %s\n' "${release_name}"
}

main() {
  parse_args "$@"
  require_preconditions
  umask 077
  case "${OPERATION}" in
    stage-and-activate|stage-only)
      render_package
      validate_rendered_package
      stage_projection
      publish_projection
      if [[ "${OPERATION}" == 'stage-only' ]]; then
        printf 'PREVIOUS_PROJECTION_RELEASE_NAME=%s\n' "${PREVIOUS_PROJECTION_RELEASE_NAME}"
        printf 'STAGED_PROJECTION_RELEASE_NAME=%s\n' "${STAGED_PROJECTION_RELEASE_NAME}"
      else
        activate_projection_release "${STAGED_PROJECTION_RELEASE_NAME}"
        printf 'Activated PROD secret package version %s (%s env members, 3 file members)\n' \
          "${SECRET_PACKAGE_VERSION}" \
          "$(node -e "const m=require('${REPO_ROOT}/config/environments/secret-packages.json');process.stdout.write(String(m.packages.prod.envNames.length))")"
      fi
      ;;
    preflight)
      validate_projection_release "${REQUESTED_RELEASE_NAME}"
      printf 'Preflight passed for PROD secret projection %s\n' "${REQUESTED_RELEASE_NAME}"
      ;;
    activate|rollback)
      activate_projection_release "${REQUESTED_RELEASE_NAME}"
      report_activation "${REQUESTED_RELEASE_NAME}"
      ;;
    current-release)
      print_current_release
      ;;
  esac
}

main "$@"
