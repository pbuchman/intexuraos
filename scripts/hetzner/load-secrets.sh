#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SECRET_PACKAGE_CLI="${REPO_ROOT}/scripts/secret-package.mjs"
RUNTIME_CONFIG_RENDERER="${REPO_ROOT}/scripts/render-runtime-config.mjs"
DEFAULT_PROD_CANDIDATE_VALIDATOR="${REPO_ROOT}/scripts/hetzner/validate-prod-secret-candidate.sh"
DEFAULT_SECRET_PACKAGE_MANIFEST="${REPO_ROOT}/config/environments/secret-packages.json"
DEFAULT_RUNTIME_CONFIG_ROOT="${REPO_ROOT}/config/environments"
PROD_CANDIDATE_VALIDATOR="${PROD_CANDIDATE_VALIDATOR:-${DEFAULT_PROD_CANDIDATE_VALIDATOR}}"
SECRET_PACKAGE_MANIFEST="${SECRET_PACKAGE_MANIFEST:-${DEFAULT_SECRET_PACKAGE_MANIFEST}}"
RUNTIME_CONFIG_ROOT="${RUNTIME_CONFIG_ROOT:-${DEFAULT_RUNTIME_CONFIG_ROOT}}"
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
SKIP_CLOUDFLARE_CREDENTIAL_SMOKE="${SKIP_CLOUDFLARE_CREDENTIAL_SMOKE:-${SKIP_RUNTIME_CREDENTIAL_SMOKE}}"
SKIP_OWNERSHIP="${SKIP_OWNERSHIP:-0}"
DEFAULT_SECRET_PACKAGE_LOCK_FILE="/run/lock/intexuraos/prod-secret-package.lock"
SECRET_PACKAGE_LOCK_FILE_WAS_SET="${SECRET_PACKAGE_LOCK_FILE+x}"
SECRET_PACKAGE_LOCK_FILE="${SECRET_PACKAGE_LOCK_FILE:-${DEFAULT_SECRET_PACKAGE_LOCK_FILE}}"
SECRET_PACKAGE_LOCK_TIMEOUT_SECONDS="${SECRET_PACKAGE_LOCK_TIMEOUT_SECONDS:-30}"
SECRET_PACKAGE_FETCH_TIMEOUT_SECONDS="${SECRET_PACKAGE_FETCH_TIMEOUT_SECONDS:-20}"
TEST_STABLE_LINK_TRANSACTION_FAILPOINT="${TEST_STABLE_LINK_TRANSACTION_FAILPOINT:-}"
TEST_PROJECTION_PUBLISH_FAILPOINT="${TEST_PROJECTION_PUBLISH_FAILPOINT:-}"
if [[ "${SKIP_OWNERSHIP}" == '1' && "${SECRET_PACKAGE_LOCK_FILE_WAS_SET}" != 'x' ]]; then
  SECRET_PACKAGE_LOCK_FILE="${TMPDIR:-/tmp}/.intexuraos-secret-package-lock-${PPID}/prod-secret-package.lock"
fi
STAGING_DIR=""
LEGACY_STAGING_DIR=""
TEMP_LINKS=()
HOST_LOCK_FD=""
PORTABLE_TEST_LOCK_DIRECTORY=""
OPERATION="stage-and-activate"
REQUESTED_RELEASE_NAME=""
PACKAGE_RELEASE_DIR=""
PACKAGE_RELEASE_NAME=""
STAGED_PROJECTION_RELEASE_NAME=""
PREVIOUS_PROJECTION_RELEASE_NAME=""
VALIDATED_PROJECTION_RELEASE_NAME=""

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
  --rollback <release-name>        Restore a previously verified projection without network gates
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
  if [[ -n "${LEGACY_STAGING_DIR}" && -d "${LEGACY_STAGING_DIR}" ]]; then
    rm -rf -- "${LEGACY_STAGING_DIR}"
  fi
  local temporary_link=""
  for temporary_link in "${TEMP_LINKS[@]}"; do
    [[ -L "${temporary_link}" ]] && rm -f -- "${temporary_link}"
  done
  if [[ -n "${PORTABLE_TEST_LOCK_DIRECTORY}" && -d "${PORTABLE_TEST_LOCK_DIRECTORY}" ]]; then
    rmdir -- "${PORTABLE_TEST_LOCK_DIRECTORY}" 2>/dev/null || true
  fi
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
  [[ "${SKIP_CLOUDFLARE_CREDENTIAL_SMOKE}" =~ ^[01]$ ]] \
    || fail 'SKIP_CLOUDFLARE_CREDENTIAL_SMOKE must be 0 or 1'
  [[ "${SKIP_OWNERSHIP}" =~ ^[01]$ ]] || fail 'SKIP_OWNERSHIP must be 0 or 1'
  if [[ -n "${TEST_STABLE_LINK_TRANSACTION_FAILPOINT}" \
    && ("${SKIP_OWNERSHIP}" != '1' \
      || "${TEST_STABLE_LINK_TRANSACTION_FAILPOINT}" \
        != 'after-commit-before-backup-cleanup') ]]; then
    fail 'Stable-link transaction failpoint is restricted to the test harness'
  fi
  if [[ -n "${TEST_PROJECTION_PUBLISH_FAILPOINT}" \
    && ("${SKIP_OWNERSHIP}" != '1' \
      || "${TEST_PROJECTION_PUBLISH_FAILPOINT}" != 'after-projection-release-durable') ]]; then
    fail 'Projection publication failpoint is restricted to the test harness'
  fi
  if [[ "${SKIP_OWNERSHIP}" != '1' \
    && ("${PROD_CANDIDATE_VALIDATOR}" != "${DEFAULT_PROD_CANDIDATE_VALIDATOR}" \
      || "${SECRET_PACKAGE_MANIFEST}" != "${DEFAULT_SECRET_PACKAGE_MANIFEST}" \
      || "${RUNTIME_CONFIG_ROOT}" != "${DEFAULT_RUNTIME_CONFIG_ROOT}") ]]; then
    fail 'Production package validation must use tracked repository files'
  fi
  if [[ -z "${EXPECTED_RUNTIME_SA_EMAIL}" ]]; then
    EXPECTED_RUNTIME_SA_EMAIL="ixos-hetzner-runtime-dev@${PROJECT_ID}.iam.gserviceaccount.com"
  fi
  command -v node >/dev/null 2>&1 || fail 'node is required'
  command -v install >/dev/null 2>&1 || fail 'install is required'
  if [[ "${OPERATION}" != 'current-release' && "${SKIP_OWNERSHIP}" != '1' ]]; then
    [[ "${EUID}" -eq 0 ]] || fail 'Mutating PROD secret loader operations must run as root'
    id -u "${DEPLOY_USER}" >/dev/null 2>&1 || fail "Deploy user ${DEPLOY_USER} is required"
    command -v getent >/dev/null 2>&1 || fail 'getent is required'
    getent group "${DEPLOY_GROUP}" >/dev/null 2>&1 \
      || fail "Group ${DEPLOY_GROUP} is required"
    getent group "${NGINX_TOKEN_GROUP}" >/dev/null 2>&1 \
      || fail "Group ${NGINX_TOKEN_GROUP} is required"
  fi
  if [[ "${OPERATION}" != 'current-release' ]]; then
    [[ "${SECRET_PACKAGE_LOCK_FILE}" == /* && ! "${SECRET_PACKAGE_LOCK_FILE}" =~ [[:cntrl:]] ]] \
      || fail 'Secret package host lock path must be absolute'
    if [[ "${SKIP_OWNERSHIP}" != '1' \
      && "${SECRET_PACKAGE_LOCK_FILE}" != "${DEFAULT_SECRET_PACKAGE_LOCK_FILE}" ]]; then
      fail 'Production secret loader operations must use the canonical host lock path'
    fi
    if ! [[ "${SECRET_PACKAGE_LOCK_TIMEOUT_SECONDS}" =~ ^[1-9][0-9]{0,2}$ ]] \
      || (( SECRET_PACKAGE_LOCK_TIMEOUT_SECONDS > 300 )); then
      fail 'Secret package host lock timeout must be between 1 and 300 seconds'
    fi
    if [[ "${SKIP_OWNERSHIP}" != '1' ]]; then
      command -v flock >/dev/null 2>&1 || fail 'flock is required for the PROD secret host lock'
    fi
  fi
  case "${OPERATION}" in
    stage-and-activate|stage-only)
      [[ "${SECRET_PACKAGE_VERSION}" =~ ^[1-9][0-9]*$ ]] \
        || fail 'SECRET_PACKAGE_VERSION must be an exact positive numeric version'
      [[ "${INTEXURAOS_COMMIT_SHA}" =~ ^[0-9a-f]{40}$ ]] \
        || fail 'INTEXURAOS_COMMIT_SHA must be a 40-character lowercase hexadecimal SHA'
      [[ -f "${SECRET_PACKAGE_CLI}" ]] || fail 'Secret package CLI is unavailable'
      [[ -f "${RUNTIME_CONFIG_RENDERER}" ]] || fail 'Runtime config renderer is unavailable'
      [[ -f "${SECRET_PACKAGE_MANIFEST}" ]] || fail 'Secret package manifest is unavailable'
      [[ -f "${PROD_CANDIDATE_VALIDATOR}" ]] \
        || fail 'PROD candidate credential validator is unavailable'
      if [[ -z "${SECRET_PACKAGE_PAYLOAD_FILE}" ]]; then
        command -v gcloud >/dev/null 2>&1 || fail 'gcloud is required for package fetch'
        command -v timeout >/dev/null 2>&1 || fail 'timeout is required for package fetch'
        if ! [[ "${SECRET_PACKAGE_FETCH_TIMEOUT_SECONDS}" =~ ^[1-9][0-9]{0,2}$ ]] \
          || (( SECRET_PACKAGE_FETCH_TIMEOUT_SECONDS > 120 )); then
          fail 'Secret package fetch timeout must be between 1 and 120 seconds'
        fi
      else
        [[ -r "${SECRET_PACKAGE_PAYLOAD_FILE}" ]] || fail 'Offline payload file is unreadable'
      fi
      ;;
    preflight|activate|rollback)
      validate_release_name "${REQUESTED_RELEASE_NAME}"
      if [[ "${REQUESTED_RELEASE_NAME}" == 'legacy-pre-packages' \
        && "${OPERATION}" != 'rollback' ]]; then
        fail 'The legacy production snapshot may only be used for offline rollback'
      fi
      if [[ "${REQUESTED_RELEASE_NAME}" != 'legacy-pre-packages' ]]; then
        [[ -f "${PROD_CANDIDATE_VALIDATOR}" ]] \
          || fail 'PROD candidate credential validator is unavailable'
        [[ -f "${SECRET_PACKAGE_MANIFEST}" ]] || fail 'Secret package manifest is unavailable'
        [[ -f "${RUNTIME_CONFIG_ROOT}/common.json" \
          && -f "${RUNTIME_CONFIG_ROOT}/prod.json" ]] \
          || fail 'Tracked production runtime configuration is unavailable'
      fi
      ;;
    current-release) ;;
    *) fail 'Unsupported loader operation' ;;
  esac
}

validate_storage_roots() {
  local allow_missing="$1"
  local include_render="$2"
  local status=0
  node --input-type=module - \
    "${SECRET_PACKAGE_RENDER_DIR}" \
    "${SECRET_PROJECTION_ROOT}" \
    "${SKIP_OWNERSHIP}" \
    "${allow_missing}" \
    "${include_render}" <<'NODE' || status=$?
import { lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const [renderInput, projectionInput, skipOwnership, allowMissing, includeRender] =
  process.argv.slice(2);

function fail(code) {
  process.exit(code);
}

function statusOrUndefined(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    fail(52);
  }
}

function canonicalCandidate(input) {
  if (typeof input !== 'string' || !isAbsolute(input) || input.includes('\0')) fail(52);
  const absolute = resolve(input);
  const directStatus = statusOrUndefined(absolute);
  if (directStatus !== undefined) {
    if (!directStatus.isDirectory() || directStatus.isSymbolicLink()) fail(52);
    try { return realpathSync(absolute); } catch { fail(52); }
  }
  let cursor = absolute;
  const suffix = [];
  while (true) {
    const parent = dirname(cursor);
    if (parent === cursor) fail(52);
    suffix.unshift(basename(cursor));
    cursor = parent;
    const status = statusOrUndefined(cursor);
    if (status === undefined) continue;
    if (!status.isDirectory() && !status.isSymbolicLink()) fail(52);
    let canonical;
    try { canonical = realpathSync(cursor); } catch { fail(52); }
    let canonicalStatus;
    try { canonicalStatus = lstatSync(canonical); } catch { fail(52); }
    if (!canonicalStatus.isDirectory() || canonicalStatus.isSymbolicLink()) fail(52);
    return resolve(join(canonical, ...suffix));
  }
}

function isSameOrAncestor(left, right) {
  const path = relative(left, right);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function validateRoot(input, expectedMode) {
  const absolute = resolve(input);
  const status = statusOrUndefined(absolute);
  if (status === undefined) {
    if (allowMissing !== '1') fail(52);
    return;
  }
  if (
    !status.isDirectory() ||
    status.isSymbolicLink() ||
    (status.mode & 0o7777) !== expectedMode ||
    (skipOwnership !== '1' && (status.uid !== 0 || status.gid !== 0))
  ) fail(52);
}

const projectionCanonical = canonicalCandidate(projectionInput);
validateRoot(projectionInput, 0o711);
if (includeRender === '1') {
  const renderCanonical = canonicalCandidate(renderInput);
  if (
    isSameOrAncestor(renderCanonical, projectionCanonical) ||
    isSameOrAncestor(projectionCanonical, renderCanonical)
  ) fail(51);
  validateRoot(renderInput, 0o700);
}
NODE
  case "${status}" in
    0) ;;
    51) fail 'PROD storage roots must be disjoint after realpath resolution' ;;
    *) fail 'PROD storage root is unsafe' ;;
  esac
}

prepare_storage_roots() {
  validate_storage_roots 1 1
  if [[ ! -e "${SECRET_PACKAGE_RENDER_DIR}" && ! -L "${SECRET_PACKAGE_RENDER_DIR}" ]]; then
    if [[ "${SKIP_OWNERSHIP}" == '1' ]]; then
      install -d -m 700 "${SECRET_PACKAGE_RENDER_DIR}"
    else
      install -d -o root -g root -m 700 "${SECRET_PACKAGE_RENDER_DIR}"
    fi
  fi
  if [[ ! -e "${SECRET_PROJECTION_ROOT}" && ! -L "${SECRET_PROJECTION_ROOT}" ]]; then
    if [[ "${SKIP_OWNERSHIP}" == '1' ]]; then
      install -d -m 711 "${SECRET_PROJECTION_ROOT}"
    else
      install -d -o root -g root -m 711 "${SECRET_PROJECTION_ROOT}"
    fi
  fi
  validate_storage_roots 0 1
}

acquire_host_lock() {
  local lock_directory="${SECRET_PACKAGE_LOCK_FILE%/*}"
  local ownership_flag="${SKIP_OWNERSHIP}"

  if [[ -e "${lock_directory}" || -L "${lock_directory}" ]]; then
    node --input-type=module - "${lock_directory}" "${ownership_flag}" <<'NODE' \
      || fail 'Secret package host lock directory is unsafe'
import { lstatSync } from 'node:fs';
const [path, skipOwnership] = process.argv.slice(2);
let status;
try { status = lstatSync(path); } catch { process.exit(1); }
if (
  !status.isDirectory() ||
  status.isSymbolicLink() ||
  (skipOwnership !== '1' && (status.uid !== 0 || status.gid !== 0))
) process.exit(1);
NODE
  elif [[ "${SKIP_OWNERSHIP}" == '1' ]]; then
    install -d -m 700 "${lock_directory}"
  else
    install -d -o root -g root -m 700 "${lock_directory}"
  fi
  chmod 700 "${lock_directory}"

  if [[ ! -e "${SECRET_PACKAGE_LOCK_FILE}" && ! -L "${SECRET_PACKAGE_LOCK_FILE}" ]]; then
    (set -o noclobber; : > "${SECRET_PACKAGE_LOCK_FILE}") 2>/dev/null || true
  fi
  node --input-type=module - "${SECRET_PACKAGE_LOCK_FILE}" "${ownership_flag}" <<'NODE' \
    || fail 'Secret package host lock file is unsafe'
import { lstatSync } from 'node:fs';
const [path, skipOwnership] = process.argv.slice(2);
let status;
try { status = lstatSync(path); } catch { process.exit(1); }
if (
  !status.isFile() ||
  status.isSymbolicLink() ||
  (skipOwnership !== '1' && (status.uid !== 0 || status.gid !== 0))
) process.exit(1);
NODE
  if [[ "${SKIP_OWNERSHIP}" != '1' ]]; then
    chown root:root "${SECRET_PACKAGE_LOCK_FILE}"
  fi
  chmod 600 "${SECRET_PACKAGE_LOCK_FILE}"

  if command -v flock >/dev/null 2>&1; then
    exec {HOST_LOCK_FD}<>"${SECRET_PACKAGE_LOCK_FILE}" \
      || fail 'Unable to open the PROD secret host lock'
    flock --exclusive --wait "${SECRET_PACKAGE_LOCK_TIMEOUT_SECONDS}" "${HOST_LOCK_FD}" \
      || fail 'Timed out waiting for the PROD secret host lock'
    return 0
  fi

  [[ "${SKIP_OWNERSHIP}" == '1' ]] \
    || fail 'flock is required for the PROD secret host lock'
  local portable_lock_directory="${SECRET_PACKAGE_LOCK_FILE}.portable-test-lock"
  local deadline=$((SECONDS + SECRET_PACKAGE_LOCK_TIMEOUT_SECONDS))
  while ! mkdir -m 700 "${portable_lock_directory}" 2>/dev/null; do
    (( SECONDS < deadline )) || fail 'Timed out waiting for the PROD secret host lock'
    sleep 0.05
  done
  PORTABLE_TEST_LOCK_DIRECTORY="${portable_lock_directory}"
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

  local render_status=0
  if [[ -n "${SECRET_PACKAGE_PAYLOAD_FILE}" ]]; then
    node "${arguments[@]}" >/dev/null || render_status=$?
  else
    timeout --signal=TERM --kill-after=5 \
      "${SECRET_PACKAGE_FETCH_TIMEOUT_SECONDS}" \
      node "${arguments[@]}" >/dev/null \
      || render_status=$?
  fi
  if [[ "${render_status}" -eq 124 || "${render_status}" -eq 137 ]]; then
    fail 'PROD secret package fetch timed out'
  fi
  [[ "${render_status}" -eq 0 ]] || fail 'Unable to fetch, verify, and render PROD package'
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
  if (!status.isFile() || (status.mode & 0o7777) !== 0o600) process.exit(9);
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

validate_candidate_credentials() {
  local credential_path="$1"
  local cloudflare_credentials_path="$2"
  local package_version="$3"
  PROJECT_ID="${PROJECT_ID}" \
  SKIP_RUNTIME_CREDENTIAL_SMOKE="${SKIP_RUNTIME_CREDENTIAL_SMOKE}" \
  SKIP_CLOUDFLARE_CREDENTIAL_SMOKE="${SKIP_CLOUDFLARE_CREDENTIAL_SMOKE}" \
  INTEXURAOS_ENVIRONMENT=prod \
    bash "${PROD_CANDIDATE_VALIDATOR}" \
      --runtime-credential "${credential_path}" \
      --cloudflare-credentials "${cloudflare_credentials_path}" \
      --package-version "${package_version}" >/dev/null \
    || fail 'PROD candidate credential canary failed'
}

stage_projection() {
  [[ -d "${SECRET_PROJECTION_ROOT}" && ! -L "${SECRET_PROJECTION_ROOT}" ]] \
    || fail 'PROD projection root is unavailable'
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

  if [[ "${SKIP_OWNERSHIP}" != '1' ]]; then
    chown "${DEPLOY_USER}:${DEPLOY_GROUP}" "${STAGING_DIR}/.env.prod" \
      "${STAGING_DIR}/runtime-sa-key.json"
    chown "root:${NGINX_TOKEN_GROUP}" "${STAGING_DIR}/internal-auth-token"
  fi
  chmod 640 "${STAGING_DIR}/internal-auth-token"
  chmod 600 "${STAGING_DIR}/.env.prod" "${STAGING_DIR}/runtime-sa-key.json" \
    "${STAGING_DIR}/cloudflare.ini" "${STAGING_DIR}/tls-private-key.pem" \
    "${STAGING_DIR}/metadata.json"
  sync_projection_release "${STAGING_DIR}"
}

sync_projection_release() {
  local release_dir="$1"
  node --input-type=module - "${release_dir}" <<'NODE' \
    || fail 'Unable to persist the complete PROD projection release'
import { constants, closeSync, fstatSync, fsyncSync, lstatSync, openSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const [releaseDir] = process.argv.slice(2);
const expectedNames = [
  '.env.prod',
  'cloudflare.ini',
  'internal-auth-token',
  'metadata.json',
  'runtime-sa-key.json',
  'tls-private-key.pem',
].sort();
const directoryStatus = lstatSync(releaseDir);
if (
  !directoryStatus.isDirectory() ||
  directoryStatus.isSymbolicLink() ||
  JSON.stringify(readdirSync(releaseDir).sort()) !== JSON.stringify(expectedNames)
) process.exit(1);
for (const name of expectedNames) {
  const path = join(releaseDir, name);
  const status = lstatSync(path);
  if (!status.isFile() || status.isSymbolicLink()) process.exit(1);
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!fstatSync(descriptor).isFile()) process.exit(1);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}
const descriptor = openSync(releaseDir, constants.O_RDONLY | constants.O_NOFOLLOW);
try {
  if (!fstatSync(descriptor).isDirectory()) process.exit(1);
  fsyncSync(descriptor);
} finally {
  closeSync(descriptor);
}
NODE
}

sync_projection_root() {
  node --input-type=module - "${SECRET_PROJECTION_ROOT}" <<'NODE' \
    || fail 'Unable to persist the PROD projection root'
import { constants, closeSync, fstatSync, fsyncSync, openSync } from 'node:fs';
const [path] = process.argv.slice(2);
const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
try {
  if (!fstatSync(descriptor).isDirectory()) process.exit(1);
  fsyncSync(descriptor);
} finally {
  closeSync(descriptor);
}
NODE
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
  local skip_candidate_canary="${2:-0}"
  local release_dir_override="${3:-}"
  local release_dir=""
  local package_version=""
  local deploy_uid=""
  local deploy_gid=""
  local nginx_gid=""
  local root_uid=""
  local root_gid=""
  if [[ -n "${release_dir_override}" ]]; then
    [[ "${release_name}" == 'legacy-pre-packages' \
      && "${release_dir_override}" == "${SECRET_PROJECTION_ROOT}/.legacy-staging."* \
      && -d "${release_dir_override}" \
      && ! -L "${release_dir_override}" ]] \
      || fail 'Legacy production projection staging path is invalid'
    release_dir="${release_dir_override}"
  else
    release_dir="$(resolve_projection_release_dir "${release_name}")"
  fi

  if [[ "${SKIP_OWNERSHIP}" != '1' ]]; then
    deploy_uid="$(id -u "${DEPLOY_USER}")"
    local deploy_group_record=""
    deploy_group_record="$(getent group "${DEPLOY_GROUP}")"
    deploy_gid="${deploy_group_record#*:*:}"
    deploy_gid="${deploy_gid%%:*}"
    local nginx_group_record=""
    nginx_group_record="$(getent group "${NGINX_TOKEN_GROUP}")"
    nginx_gid="${nginx_group_record#*:*:}"
    nginx_gid="${nginx_gid%%:*}"
    root_uid="$(id -u root)"
    local root_group_record=""
    root_group_record="$(getent group root)"
    root_gid="${root_group_record#*:*:}"
    root_gid="${root_gid%%:*}"
  fi

  if ! node --input-type=module - \
    "${release_dir}" \
    "${release_name}" \
    "${PROJECT_ID}" \
    "${EXPECTED_RUNTIME_SA_EMAIL}" \
    "${SKIP_OWNERSHIP}" \
    "${deploy_uid}" \
    "${deploy_gid}" \
    "${nginx_gid}" \
    "${root_uid}" \
    "${root_gid}" \
    "${SECRET_PACKAGE_MANIFEST}" \
    "${RUNTIME_CONFIG_ROOT}/common.json" \
    "${RUNTIME_CONFIG_ROOT}/prod.json" \
    "${RUNTIME_SA_KEY_FILE}" \
    "${release_dir_override:+1}" <<'NODE'
import { createHash, createPrivateKey } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parse } from 'dotenv';
const [
  releaseDir,
  releaseName,
  expectedProject,
  expectedEmail,
  skipOwnership,
  deployUidValue,
  deployGidValue,
  nginxGidValue,
  rootUidValue,
  rootGidValue,
  manifestPath,
  commonConfigPath,
  prodConfigPath,
  expectedRuntimeCredentialPath,
  allowLegacyStaging,
] = process.argv.slice(2);
const isLegacy = releaseName === 'legacy-pre-packages';
const releaseMatch = /^prod-v([1-9][0-9]*)-[0-9a-f]{8}-[0-9a-f]{40}$/u.exec(releaseName);
if (
  (!isLegacy && releaseMatch === null) ||
  (basename(releaseDir) !== releaseName &&
    !(isLegacy && allowLegacyStaging === '1' && basename(releaseDir).startsWith('.legacy-staging.')))
) process.exit(40);
const packageVersion = releaseMatch?.[1];
const ownershipEnabled = skipOwnership !== '1';
const deployUid = Number(deployUidValue);
const deployGid = Number(deployGidValue);
const nginxGid = Number(nginxGidValue);
const rootUid = Number(rootUidValue);
const rootGid = Number(rootGidValue);
const expectedModes = new Map([
  ['.env.prod', 0o600],
  ['runtime-sa-key.json', 0o600],
  ['internal-auth-token', 0o640],
  ['cloudflare.ini', 0o600],
  ['tls-private-key.pem', 0o600],
  ['metadata.json', 0o600],
]);
const expectedOwners = new Map([
  ['.env.prod', [deployUid, deployGid]],
  ['runtime-sa-key.json', [deployUid, deployGid]],
  ['internal-auth-token', [rootUid, nginxGid]],
  ['cloudflare.ini', [rootUid, rootGid]],
  ['tls-private-key.pem', [rootUid, rootGid]],
  ['metadata.json', [rootUid, rootGid]],
]);
let releaseStatus;
try { releaseStatus = lstatSync(releaseDir); } catch { process.exit(41); }
if (
  !releaseStatus.isDirectory() ||
  releaseStatus.isSymbolicLink() ||
  (releaseStatus.mode & 0o7777) !== 0o711 ||
  (ownershipEnabled && (releaseStatus.uid !== rootUid || releaseStatus.gid !== rootGid))
) process.exit(41);
let names;
try { names = readdirSync(releaseDir).sort(); } catch { process.exit(41); }
if (JSON.stringify(names) !== JSON.stringify([...expectedModes.keys()].sort())) process.exit(41);
for (const [name, expectedMode] of expectedModes) {
  let status;
  try { status = lstatSync(join(releaseDir, name)); } catch { process.exit(41); }
  const [expectedUid, expectedGid] = expectedOwners.get(name);
  if (
    !status.isFile() ||
    status.isSymbolicLink() ||
    (status.mode & 0o7777) !== expectedMode ||
    (ownershipEnabled && (status.uid !== expectedUid || status.gid !== expectedGid))
  ) process.exit(41);
}
let metadata;
let environmentText;
let environment;
let runtimeCredential;
let internalAuthToken;
let cloudflareCredentials;
let tlsPrivateKey;
try {
  metadata = JSON.parse(readFileSync(join(releaseDir, 'metadata.json'), 'utf8'));
  environmentText = readFileSync(join(releaseDir, '.env.prod'), 'utf8');
  environment = parse(environmentText);
  runtimeCredential = JSON.parse(readFileSync(join(releaseDir, 'runtime-sa-key.json'), 'utf8'));
  internalAuthToken = readFileSync(join(releaseDir, 'internal-auth-token'), 'utf8');
  cloudflareCredentials = readFileSync(join(releaseDir, 'cloudflare.ini'), 'utf8');
  tlsPrivateKey = readFileSync(join(releaseDir, 'tls-private-key.pem'), 'utf8');
} catch { process.exit(42); }

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  return (
    isPlainObject(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expectedKeys].sort())
  );
}

function sameArray(left, right) {
  return Array.isArray(left) && JSON.stringify(left) === JSON.stringify(right);
}

const environmentLines = environmentText.split(/\r?\n/u);
const assignmentLines = environmentLines.filter(
  (line) => line.length > 0 && !/^\s*$/u.test(line) && !line.startsWith('#')
);
if (assignmentLines.some((line) => !/^[A-Z][A-Z0-9_]*=/u.test(line))) process.exit(42);
const assignedNames = assignmentLines.map((line) => /^([A-Z][A-Z0-9_]*)=/u.exec(line)[1]);
if (
  assignedNames.length !== new Set(assignedNames).size ||
  Object.keys(environment).length !== assignedNames.length ||
  assignedNames.some((name) => typeof environment[name] !== 'string' || environment[name].length === 0)
) process.exit(42);

if (isLegacy) {
  const artifactNames = [
    '.env.prod',
    'runtime-sa-key.json',
    'internal-auth-token',
    'cloudflare.ini',
    'tls-private-key.pem',
  ];
  if (
    !hasExactKeys(metadata, [
      'artifactSha256',
      'environment',
      'releaseName',
      'schemaVersion',
      'snapshotType',
    ]) ||
    metadata.schemaVersion !== 1 ||
    metadata.environment !== 'prod' ||
    metadata.releaseName !== 'legacy-pre-packages' ||
    metadata.snapshotType !== 'pre-package-runtime' ||
    !hasExactKeys(metadata.artifactSha256, artifactNames) ||
    artifactNames.some((name) => {
      const digest = metadata.artifactSha256[name];
      return (
        typeof digest !== 'string' ||
        !/^[0-9a-f]{64}$/u.test(digest) ||
        digest !== createHash('sha256').update(readFileSync(join(releaseDir, name))).digest('hex')
      );
    }) ||
    environment.INTEXURAOS_ENVIRONMENT !== 'prod' ||
    environment.PROJECT_ID !== expectedProject ||
    environment.GOOGLE_CLOUD_PROJECT !== expectedProject ||
    environment.GOOGLE_APPLICATION_CREDENTIALS !== expectedRuntimeCredentialPath
  ) process.exit(42);
} else {
  let manifest;
  let commonConfig;
  let prodConfig;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    commonConfig = JSON.parse(readFileSync(commonConfigPath, 'utf8'));
    prodConfig = JSON.parse(readFileSync(prodConfigPath, 'utf8'));
  } catch { process.exit(42); }
  const packageDefinition = manifest?.packages?.prod;
  const packageEnvNames = packageDefinition?.envNames;
  const renderedFiles = [
    'cloudflare-dns-api-token',
    'runtime-gcp-service-account.json',
    'tls-private-key.pem',
  ];
  const fixedEnvironmentNames = [
    'INTEXURAOS_ENVIRONMENT',
    'INTEXURAOS_RUNTIME',
    'INTEXURAOS_SECRET_PACKAGE_VERSION',
    'INTEXURAOS_GCP_PROJECT_ID',
    'GOOGLE_CLOUD_PROJECT',
    'PROJECT_ID',
    'REGION',
    'HETZNER_PROVISIONER_GOOGLE_APPLICATION_CREDENTIALS',
    'GOOGLE_APPLICATION_CREDENTIALS',
    'INTEXURAOS_PUBLIC_ORIGIN',
    'INTEXURAOS_WEB_APP_URL',
    'INTEXURAOS_WEB_URL',
    'INTEXURAOS_CODE_TASK_CALLBACK_BASE_URL',
    'INTEXURAOS_SENTRY_CODE_TASK_REPOSITORY',
    'INTEXURAOS_SENTRY_CODE_TASK_BASE_BRANCH',
    'NODE_ENV',
  ];
  if (
    !isPlainObject(commonConfig) ||
    !isPlainObject(prodConfig) ||
    !Array.isArray(packageEnvNames) ||
    packageEnvNames.length === 0 ||
    packageEnvNames.length !== new Set(packageEnvNames).size ||
    packageEnvNames.some((name) => typeof name !== 'string' || !/^[A-Z][A-Z0-9_]*$/u.test(name))
  ) process.exit(42);
  const expectedEnvironmentNames = [
    ...fixedEnvironmentNames,
    ...Object.keys(commonConfig),
    ...Object.keys(prodConfig),
    ...packageEnvNames,
  ];
  if (
    expectedEnvironmentNames.length !== new Set(expectedEnvironmentNames).size ||
    JSON.stringify([...assignedNames].sort()) !==
      JSON.stringify([...expectedEnvironmentNames].sort()) ||
    !sameArray(metadata.envNames, packageEnvNames) ||
    !sameArray(metadata.files, renderedFiles) ||
    !hasExactKeys(metadata, [
      'byteLength',
      'crc32c',
      'environment',
      'envNames',
      'files',
      'schemaVersion',
      'secretId',
      'serviceAccount',
      'version',
    ]) ||
    metadata.schemaVersion !== 1 ||
    metadata.environment !== 'prod' ||
    metadata.secretId !== packageDefinition.secretId ||
    metadata.version !== packageVersion ||
    !Number.isSafeInteger(metadata.byteLength) ||
    metadata.byteLength < 1 ||
    typeof metadata.crc32c !== 'string' ||
    metadata.crc32c.length === 0 ||
    !hasExactKeys(metadata.serviceAccount, ['clientEmail', 'privateKeyId', 'projectId']) ||
    metadata.serviceAccount.projectId !== expectedProject ||
    metadata.serviceAccount.clientEmail !== expectedEmail ||
    typeof metadata.serviceAccount.privateKeyId !== 'string' ||
    !/^[0-9a-f]{40}$/u.test(metadata.serviceAccount.privateKeyId) ||
    environment.INTEXURAOS_SECRET_PACKAGE_VERSION !== packageVersion ||
    environment.INTEXURAOS_ENVIRONMENT !== 'prod' ||
    environment.INTEXURAOS_RUNTIME !== 'prod' ||
    environment.INTEXURAOS_GCP_PROJECT_ID !== expectedProject ||
    environment.GOOGLE_CLOUD_PROJECT !== expectedProject ||
    environment.PROJECT_ID !== expectedProject ||
    environment.GOOGLE_APPLICATION_CREDENTIALS !== expectedRuntimeCredentialPath
  ) process.exit(42);
}

if (
  runtimeCredential?.type !== 'service_account' ||
  runtimeCredential?.project_id !== expectedProject ||
  runtimeCredential?.client_email !== expectedEmail ||
  typeof runtimeCredential?.private_key_id !== 'string' ||
  !/^[0-9a-f]{40}$/u.test(runtimeCredential.private_key_id) ||
  (!isLegacy && runtimeCredential.private_key_id !== metadata.serviceAccount.privateKeyId) ||
  typeof runtimeCredential?.private_key !== 'string' ||
  runtimeCredential.private_key.length > 32768 ||
  !/^-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]+-----END (?:RSA |EC )?PRIVATE KEY-----\n?$/u.test(
    runtimeCredential.private_key
  )
) process.exit(43);
try { createPrivateKey(runtimeCredential.private_key); } catch { process.exit(43); }
if (
  typeof internalAuthToken !== 'string' ||
  internalAuthToken.length < 16 ||
  internalAuthToken.length > 4096 ||
  /[\s\0]/u.test(internalAuthToken) ||
  environment.INTEXURAOS_INTERNAL_AUTH_TOKEN !== internalAuthToken
) process.exit(44);
if (!/^dns_cloudflare_api_token = [A-Za-z0-9_-]{20,256}\n$/u.test(cloudflareCredentials)) {
  process.exit(45);
}
if (
  typeof tlsPrivateKey !== 'string' ||
  tlsPrivateKey.length > 32768 ||
  !/^-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]+-----END (?:RSA |EC )?PRIVATE KEY-----\n?$/u.test(
    tlsPrivateKey
  )
) process.exit(46);
try { createPrivateKey(tlsPrivateKey); } catch { process.exit(46); }
NODE
  then
    if [[ "${release_name}" == 'legacy-pre-packages' ]]; then
      fail 'PROD legacy snapshot validation failed'
    fi
    fail 'PROD projection release local validation failed'
  fi
  if [[ "${release_name}" == 'legacy-pre-packages' ]]; then
    VALIDATED_PROJECTION_RELEASE_NAME="${release_name}"
    return 0
  fi
  package_version="$(node --input-type=module - "${release_dir}/metadata.json" <<'NODE'
import { readFileSync } from 'node:fs';
const [path] = process.argv.slice(2);
const metadata = JSON.parse(readFileSync(path, 'utf8'));
if (typeof metadata?.version !== 'string' || !/^[1-9][0-9]*$/u.test(metadata.version)) {
  process.exit(1);
}
process.stdout.write(metadata.version);
NODE
  )" || fail 'Projection package version is invalid'
  if [[ "${skip_candidate_canary}" != '1' ]]; then
    validate_candidate_credentials \
      "${release_dir}/runtime-sa-key.json" \
      "${release_dir}/cloudflare.ini" \
      "${package_version}"
    VALIDATED_PROJECTION_RELEASE_NAME="${release_name}"
  fi
}

preserve_legacy_files() {
  local fallback_dir="$1"
  [[ ! -e "${SECRET_PROJECTION_ROOT}/current" && ! -L "${SECRET_PROJECTION_ROOT}/current" ]] \
    || return 0
  local backup_dir="${SECRET_PROJECTION_ROOT}/legacy-pre-packages"
  if [[ -e "${backup_dir}" || -L "${backup_dir}" ]]; then
    [[ -d "${backup_dir}" && ! -L "${backup_dir}" ]] \
      || fail 'Legacy production projection is unsafe'
    validate_projection_release 'legacy-pre-packages' 1
    return 0
  fi
  local source=""
  local name=""
  local file_mode=""
  LEGACY_STAGING_DIR="$(mktemp -d "${SECRET_PROJECTION_ROOT}/.legacy-staging.XXXXXX")" \
    || fail 'Unable to allocate legacy production projection staging directory'
  chmod 700 "${LEGACY_STAGING_DIR}"
  if [[ "${SKIP_OWNERSHIP}" != '1' ]]; then
    chown root:root "${LEGACY_STAGING_DIR}"
  fi
  while IFS='|' read -r source name file_mode; do
    if [[ -f "${source}" && ! -L "${source}" ]]; then
      install -m "${file_mode}" "${source}" "${LEGACY_STAGING_DIR}/${name}"
    else
      install -m "${file_mode}" "${fallback_dir}/${name}" "${LEGACY_STAGING_DIR}/${name}"
    fi
  done <<EOF
${OUTPUT_FILE}|.env.prod|600
${RUNTIME_SA_KEY_FILE}|runtime-sa-key.json|600
${INTERNAL_AUTH_TOKEN_FILE}|internal-auth-token|640
${CLOUDFLARE_CREDENTIALS_FILE}|cloudflare.ini|600
${TLS_PRIVATE_KEY_FILE}|tls-private-key.pem|600
EOF
  if [[ "${SKIP_OWNERSHIP}" != '1' ]]; then
    chown "${DEPLOY_USER}:${DEPLOY_GROUP}" "${LEGACY_STAGING_DIR}/.env.prod" \
      "${LEGACY_STAGING_DIR}/runtime-sa-key.json"
    chown "root:${NGINX_TOKEN_GROUP}" "${LEGACY_STAGING_DIR}/internal-auth-token"
  fi
  if [[ "${SKIP_OWNERSHIP}" == '1' \
    && "${TEST_FAIL_LEGACY_SNAPSHOT_AFTER_COPY:-0}" == '1' ]]; then
    fail 'Injected legacy production snapshot seal failure'
  fi
  node --input-type=module - "${LEGACY_STAGING_DIR}" <<'NODE' \
    || fail 'Unable to seal the legacy production projection'
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
const [releaseDir] = process.argv.slice(2);
const artifactNames = [
  '.env.prod',
  'runtime-sa-key.json',
  'internal-auth-token',
  'cloudflare.ini',
  'tls-private-key.pem',
];
const artifactSha256 = Object.fromEntries(
  artifactNames.map((name) => [
    name,
    createHash('sha256').update(readFileSync(join(releaseDir, name))).digest('hex'),
  ])
);
const metadata = {
  schemaVersion: 1,
  environment: 'prod',
  releaseName: 'legacy-pre-packages',
  snapshotType: 'pre-package-runtime',
  artifactSha256,
};
const target = join(releaseDir, 'metadata.json');
const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
let descriptor;
try {
  descriptor = openSync(temporary, 'wx', 0o600);
  writeFileSync(descriptor, `${JSON.stringify(metadata)}\n`);
  fsyncSync(descriptor);
  closeSync(descriptor);
  descriptor = undefined;
  chmodSync(temporary, 0o600);
  renameSync(temporary, target);
  for (const name of artifactNames) {
    const artifact = openSync(join(releaseDir, name), 'r');
    try { fsyncSync(artifact); } finally { closeSync(artifact); }
  }
  const directory = openSync(releaseDir, 'r');
  try { fsyncSync(directory); } finally { closeSync(directory); }
} catch (error) {
  if (descriptor !== undefined) closeSync(descriptor);
  rmSync(temporary, { force: true });
  throw error;
}
NODE
  chmod 711 "${LEGACY_STAGING_DIR}"
  validate_projection_release 'legacy-pre-packages' 1 "${LEGACY_STAGING_DIR}"
  mv -n -- "${LEGACY_STAGING_DIR}" "${backup_dir}" \
    || fail 'Unable to publish the legacy production projection'
  [[ ! -e "${LEGACY_STAGING_DIR}" && -d "${backup_dir}" && ! -L "${backup_dir}" ]] \
    || fail 'Legacy production projection publication collided with an existing path'
  LEGACY_STAGING_DIR=""
  node --input-type=module - "${SECRET_PROJECTION_ROOT}" <<'NODE' \
    || fail 'Unable to persist the legacy production projection'
import { closeSync, fsyncSync, openSync } from 'node:fs';
const [path] = process.argv.slice(2);
const descriptor = openSync(path, 'r');
try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
NODE
  validate_projection_release 'legacy-pre-packages' 1
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
  const normalizedSkip = entry?.skip === undefined && entry?.hadOriginal === false ? false : entry?.skip;
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
    typeof normalizedSkip !== 'boolean'
  ) {
    throw new Error('invalid transaction marker');
  }
  return { ...entry, skip: normalizedSkip };
}

function readMarker() {
  const markerStatus = statusOrUndefined(markerPath);
  if (markerStatus === undefined) return undefined;
  if (
    !markerStatus.isFile() ||
    markerStatus.isSymbolicLink() ||
    (markerStatus.mode & 0o7777) !== 0o600
  ) {
    throw new Error('unsafe transaction marker');
  }
  const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
  const keys =
    marker !== null && typeof marker === 'object' && !Array.isArray(marker)
      ? Object.keys(marker).sort()
      : [];
  let state;
  if (
    marker?.schemaVersion === 1 &&
    JSON.stringify(keys) === JSON.stringify(['entries', 'schemaVersion'])
  ) {
    state = 'installing';
  } else if (
    marker?.schemaVersion === 2 &&
    JSON.stringify(keys) === JSON.stringify(['entries', 'schemaVersion', 'state']) &&
    (marker.state === 'installing' || marker.state === 'committed')
  ) {
    state = marker.state;
  } else {
    throw new Error('invalid transaction marker');
  }
  if (!Array.isArray(marker.entries) || marker.entries.length !== expected.length) {
    throw new Error('invalid transaction marker');
  }
  return {
    entries: marker.entries.map((entry, index) => validateEntry(entry, expected[index])),
    state,
  };
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

function cleanupCommitted(entries) {
  for (const entry of entries) {
    removeNonDirectory(entry.temporary);
    const currentStatus = statusOrUndefined(entry.path);
    if (
      currentStatus === undefined ||
      !currentStatus.isSymbolicLink() ||
      readlinkSync(entry.path) !== entry.target
    ) {
      throw new Error('committed transaction target is invalid');
    }
    const backupStatus = statusOrUndefined(entry.backup);
    if (backupStatus?.isDirectory() && !backupStatus.isSymbolicLink()) {
      throw new Error('unsafe transaction backup');
    }
  }
  for (const entry of entries) rmSync(entry.backup, { force: true });
  syncStableParents();
}

function recoverInterruptedTransaction() {
  const transaction = readMarker();
  if (transaction === undefined) return;
  if (transaction.state === 'committed') cleanupCommitted(transaction.entries);
  else restore(transaction.entries);
  removeMarker();
}

function writeMarker(entries, state) {
  if (state !== 'installing' && state !== 'committed') {
    throw new Error('invalid transaction marker state');
  }
  const temporaryMarker = `${markerPath}.${process.pid}.${randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = openSync(temporaryMarker, 'wx', 0o600);
    writeFileSync(descriptor, `${JSON.stringify({ schemaVersion: 2, state, entries })}\n`);
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  try {
    chmodSync(temporaryMarker, 0o600);
    renameSync(temporaryMarker, markerPath);
    syncDirectory(dirname(markerPath));
  } catch (error) {
    rmSync(temporaryMarker, { force: true });
    throw error;
  }
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
    const skip = Boolean(
      originalStatus?.isSymbolicLink() && readlinkSync(entry.path) === entry.target
    );
    return {
      ...entry,
      backup: `${entry.path}.package-backup-${process.pid}-${randomUUID()}`,
      temporary: `${entry.path}.package-next-${process.pid}-${randomUUID()}`,
      hadOriginal: originalStatus !== undefined,
      skip,
    };
  });
  writeMarker(entries, 'installing');
  try {
    for (const entry of entries) {
      if (entry.skip) continue;
      const parent = dirname(entry.path);
      mkdirSync(parent, { recursive: true, mode: 0o755 });
      const parentStatus = lstatSync(parent);
      if (!parentStatus.isDirectory() || parentStatus.isSymbolicLink()) {
        throw new Error('stable path parent is unsafe');
      }
      if (entry.hadOriginal) {
        renameSync(entry.path, entry.backup);
        // Make the only recoverable original name durable before replacing the stable path.
        syncDirectory(parent);
      }
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
    writeMarker(entries, 'committed');
    if (
      process.env.TEST_STABLE_LINK_TRANSACTION_FAILPOINT ===
      'after-commit-before-backup-cleanup'
    ) {
      process.exit(86);
    }
    cleanupCommitted(entries);
    removeMarker();
  } catch (error) {
    try {
      const transaction = readMarker();
      if (transaction?.state === 'installing') {
        restore(transaction.entries);
        removeMarker();
      }
    } catch {
      // Leave the root-owned marker and any managed backups for deterministic recovery.
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
  local skip_candidate_canary="${2:-0}"
  local release_dir=""
  if [[ "${VALIDATED_PROJECTION_RELEASE_NAME}" != "${release_name}" ]]; then
    validate_projection_release "${release_name}" "${skip_candidate_canary}"
  fi
  release_dir="$(resolve_projection_release_dir "${release_name}")"
  sync_projection_release "${release_dir}"
  sync_projection_root
  if [[ ! -L "${SECRET_PROJECTION_ROOT}/current" ]]; then
    [[ ! -e "${SECRET_PROJECTION_ROOT}/current" ]] \
      || fail 'Active production projection pointer is invalid'
    [[ -d "${SECRET_PROJECTION_ROOT}/legacy-pre-packages" ]] \
      || fail 'Legacy production projection is unavailable'
    if [[ "${VALIDATED_PROJECTION_RELEASE_NAME}" != 'legacy-pre-packages' ]]; then
      validate_projection_release 'legacy-pre-packages' 1
    fi
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
      sync_projection_release "${projection_release_dir}"
      rm -rf -- "${STAGING_DIR}"
      STAGING_DIR=""
      sync_projection_root
    else
      fail 'Existing immutable production projection does not match this package and commit'
    fi
  else
    mv "${STAGING_DIR}" "${projection_release_dir}"
    STAGING_DIR=""
    sync_projection_root
  fi
  if [[ "${TEST_PROJECTION_PUBLISH_FAILPOINT}" == 'after-projection-release-durable' ]]; then
    fail 'Injected durable projection release publication failure'
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
  if [[ "${OPERATION}" != 'current-release' ]]; then
    acquire_host_lock
  fi
  case "${OPERATION}" in
    stage-and-activate|stage-only) prepare_storage_roots ;;
    preflight|activate|rollback) validate_storage_roots 0 1 ;;
    current-release) ;;
  esac
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
    activate)
      activate_projection_release "${REQUESTED_RELEASE_NAME}"
      report_activation "${REQUESTED_RELEASE_NAME}"
      ;;
    rollback)
      # Emergency compensation must remain available when an external API is
      # unavailable or the older release's 24-hour Cloudflare review has
      # expired. The target is still validated structurally and the deploy
      # wrapper immediately runs full post-switch health checks.
      activate_projection_release "${REQUESTED_RELEASE_NAME}" 1
      report_activation "${REQUESTED_RELEASE_NAME}"
      ;;
    current-release)
      print_current_release
      ;;
  esac
}

main "$@"
