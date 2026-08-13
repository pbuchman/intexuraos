#!/usr/bin/env bash
# Render the exact DEV secret package, merge it with tracked runtime config,
# and promote every local projection through one crash-durable atomic pointer.

set -euo pipefail

SCRIPT_NAME="$(basename "$0")"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SECRET_PACKAGE_CLI="${REPO_ROOT}/scripts/secret-package.mjs"
SECRET_PROJECTION_PROMOTER="${REPO_ROOT}/scripts/lib/dev-secret-projection.mjs"
SECRET_SYNC_LOCK="${REPO_ROOT}/scripts/lib/dev-secret-sync-lock.mjs"
RUNTIME_CONFIG_RENDERER="${REPO_ROOT}/scripts/render-runtime-config.mjs"

ENVIRONMENT="dev"
CLI_PROJECT_ID=""
CLI_PACKAGE_VERSION=""
ENVRC_FILE="${REPO_ROOT}/.envrc"
PROJECTION_OUTPUT_DIR="${INTEXURAOS_SECRET_PACKAGE_PROJECTION_DIR:-${INTEXURAOS_SECRET_PACKAGE_ROOT:-${HOME}/.config/intexuraos/secret-packages/dev}}"
GITHUB_KEY_OUTPUT="${GITHUB_APP_PRIVATE_KEY_PATH:-${HOME}/.code-orchestrator/github-app.pem}"
PAYLOAD_FILE=""
REGION_VALUE="${REGION:-europe-central2}"
RENDERER_CREDENTIAL_FILE="${SECRET_PACKAGE_GOOGLE_APPLICATION_CREDENTIALS:-}"

RUNTIME_CONFIG_FILE=""
ENVRC_TEMP_FILE=""
CANDIDATE_RENDER_DIR=""
SYNC_LOCK_HELD=0
SYNC_LOCK_OWNER_TOKEN=""
SYNC_WORK_DIR=""

usage() {
  cat <<EOF
Usage:
  ${SCRIPT_NAME} [dev] --version <N> [options]

The version may instead be supplied through SECRET_PACKAGE_VERSION. It must be
an exact positive integer.

Options:
  --version <N>                    Exact DEV package version
  --project-id <project_id>        Override GCP project ID
  --output <path>                  .envrc output (default: <repo>/.envrc)
  --package-output-dir <path>      Private DEV projection root
  --output-dir <path>              Alias for --package-output-dir
  --github-app-key-output <path>   GitHub App PEM output
  --payload-file <path>            Offline package payload (tests/bootstrap)
  -h, --help                       Show this help

Project ID resolution order:
  1) --project-id
  2) PROJECT_ID
  3) active gcloud project

Set SECRET_PACKAGE_GOOGLE_APPLICATION_CREDENTIALS to the dedicated home-dev
renderer key. It is used only to fetch the DEV package and is not projected.
EOF
}

fail() {
  echo "ERROR: $1" >&2
  exit 1
}

cleanup() {
  local exit_code=$?
  trap - EXIT
  set +e

  if [[ -n "${RUNTIME_CONFIG_FILE}" && -f "${RUNTIME_CONFIG_FILE}" ]]; then
    rm -f "${RUNTIME_CONFIG_FILE}"
  fi
  if [[ -n "${ENVRC_TEMP_FILE}" && -f "${ENVRC_TEMP_FILE}" ]]; then
    rm -f "${ENVRC_TEMP_FILE}"
  fi
  if [[ -n "${SYNC_WORK_DIR}" ]]; then
    rm -rf "${SYNC_WORK_DIR}"
  fi
  if [[ ${SYNC_LOCK_HELD} -eq 1 && -n "${SYNC_LOCK_OWNER_TOKEN}" ]]; then
    node "${SECRET_SYNC_LOCK}" release \
      --package-root "${PROJECTION_OUTPUT_DIR}" \
      --owner-pid "$$" \
      --owner-token "${SYNC_LOCK_OWNER_TOKEN}" \
      --sync-script "${BASH_SOURCE[0]}" \
      >/dev/null 2>&1
  fi

  exit "${exit_code}"
}

trap cleanup EXIT

require_option_value() {
  local option_name="$1"
  local option_value="${2:-}"
  [[ -n "${option_value}" ]] || fail "${option_name} requires a value"
}

parse_args() {
  local environment_set=0

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --version)
        require_option_value "$1" "${2:-}"
        CLI_PACKAGE_VERSION="$2"
        shift 2
        ;;
      --version=*)
        CLI_PACKAGE_VERSION="${1#*=}"
        shift
        ;;
      --project-id)
        require_option_value "$1" "${2:-}"
        CLI_PROJECT_ID="$2"
        shift 2
        ;;
      --project-id=*)
        CLI_PROJECT_ID="${1#*=}"
        shift
        ;;
      --output)
        require_option_value "$1" "${2:-}"
        ENVRC_FILE="$2"
        shift 2
        ;;
      --output=*)
        ENVRC_FILE="${1#*=}"
        shift
        ;;
      --package-output-dir|--output-dir)
        require_option_value "$1" "${2:-}"
        PROJECTION_OUTPUT_DIR="$2"
        shift 2
        ;;
      --package-output-dir=*|--output-dir=*)
        PROJECTION_OUTPUT_DIR="${1#*=}"
        shift
        ;;
      --github-app-key-output|--github-app-private-key-output)
        require_option_value "$1" "${2:-}"
        GITHUB_KEY_OUTPUT="$2"
        shift 2
        ;;
      --github-app-key-output=*|--github-app-private-key-output=*)
        GITHUB_KEY_OUTPUT="${1#*=}"
        shift
        ;;
      --payload-file)
        require_option_value "$1" "${2:-}"
        PAYLOAD_FILE="$2"
        shift 2
        ;;
      --payload-file=*)
        PAYLOAD_FILE="${1#*=}"
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      --*)
        fail "Unknown option: $1"
        ;;
      *)
        [[ ${environment_set} -eq 0 ]] || fail "Unexpected positional argument: $1"
        ENVIRONMENT="$1"
        environment_set=1
        shift
        ;;
    esac
  done
}

resolve_package_version() {
  local resolved="${CLI_PACKAGE_VERSION:-${SECRET_PACKAGE_VERSION:-}}"
  if [[ ! "${resolved}" =~ ^[1-9][0-9]*$ ]]; then
    fail "--version or SECRET_PACKAGE_VERSION must be an exact positive numeric version"
  fi
  PACKAGE_VERSION="${resolved}"
}

resolve_project_id() {
  local resolved=""
  if [[ -n "${CLI_PROJECT_ID}" ]]; then
    resolved="${CLI_PROJECT_ID}"
  elif [[ -n "${PROJECT_ID:-}" ]]; then
    resolved="${PROJECT_ID}"
  else
    command -v gcloud >/dev/null 2>&1 \
      || fail "gcloud CLI is required when --project-id and PROJECT_ID are absent"
    resolved="$(gcloud config get-value project 2>/dev/null || true)"
  fi
  if [[ ! "${resolved}" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]]; then
    fail "Resolved GCP project ID is invalid"
  fi
  PROJECT_ID="${resolved}"
}

validate_inputs() {
  [[ "${ENVIRONMENT}" == "dev" ]] || fail "Local package sync supports only the dev environment"
  [[ -n "${ENVRC_FILE}" ]] || fail "--output must not be empty"
  [[ -n "${PROJECTION_OUTPUT_DIR}" ]] || fail "--package-output-dir must not be empty"
  [[ -n "${GITHUB_KEY_OUTPUT}" ]] || fail "--github-app-key-output must not be empty"
  if [[ -n "${PAYLOAD_FILE}" && ! -f "${PAYLOAD_FILE}" ]]; then
    fail "Offline payload file is unavailable"
  fi
  if [[ -z "${PAYLOAD_FILE}" && -n "${RENDERER_CREDENTIAL_FILE}" ]]; then
    if ! node --input-type=module - \
      "${RENDERER_CREDENTIAL_FILE}" \
      "${PROJECT_ID}" <<'NODE'
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs';
const [path, projectId] = process.argv.slice(2);
let status;
let credential;
let descriptor;
try {
  status = lstatSync(path);
  if (!status.isFile() || status.isSymbolicLink() || (status.mode & 0o177) !== 0) process.exit(1);
  descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  const openedStatus = fstatSync(descriptor);
  if (!openedStatus.isFile() || (openedStatus.mode & 0o177) !== 0) process.exit(1);
  credential = JSON.parse(readFileSync(descriptor, 'utf8'));
} catch {
  process.exit(1);
} finally {
  if (descriptor !== undefined) closeSync(descriptor);
}
const expectedEmail = `ixos-home-secret-renderer-dev@${projectId}.iam.gserviceaccount.com`;
if (
  credential?.type !== 'service_account' ||
  credential?.project_id !== projectId ||
  credential?.client_email !== expectedEmail
) process.exit(1);
NODE
    then
      fail "Dedicated DEV package renderer credential is invalid or not mode 0600"
    fi
  fi
  [[ "${REGION_VALUE}" =~ ^[a-z][a-z0-9-]*[a-z0-9]$ ]] || fail "REGION is invalid"
}

acquire_sync_lock() {
  SYNC_LOCK_OWNER_TOKEN="$(node "${SECRET_SYNC_LOCK}" create-token)" \
    || fail "Unable to create a DEV secret-package sync owner"
  node "${SECRET_SYNC_LOCK}" acquire \
    --package-root "${PROJECTION_OUTPUT_DIR}" \
    --owner-pid "$$" \
    --owner-token "${SYNC_LOCK_OWNER_TOKEN}" \
    --sync-script "${BASH_SOURCE[0]}" \
    || fail "Unable to acquire the DEV secret-package sync lock"
  SYNC_LOCK_HELD=1
  SYNC_WORK_DIR="${PROJECTION_OUTPUT_DIR}/.sync-work.${SYNC_LOCK_OWNER_TOKEN}"
  mkdir "${SYNC_WORK_DIR}"
  chmod 700 "${SYNC_WORK_DIR}"

  if [[ -n "${INTEXURAOS_SECRET_SYNC_TEST_LOCK_HOLD_MS:-}" && "${INTEXURAOS_SECRET_SYNC_TEST_LOCK_HOLD_MS}" != "0" ]]; then
    [[ "${NODE_ENV:-}" == "test" ]] || fail "DEV secret sync test lock hold is forbidden"
    [[ "${INTEXURAOS_SECRET_SYNC_TEST_LOCK_HOLD_MS}" =~ ^[1-9][0-9]{0,3}$ ]] \
      || fail "DEV secret sync test lock hold is invalid"
    node -e 'setTimeout(() => {}, Number(process.argv[1]))' \
      "${INTEXURAOS_SECRET_SYNC_TEST_LOCK_HOLD_MS}"
  fi
}

render_tracked_config() {
  RUNTIME_CONFIG_FILE="${SYNC_WORK_DIR}/runtime-config.env"
  : > "${RUNTIME_CONFIG_FILE}"
  chmod 600 "${RUNTIME_CONFIG_FILE}"
  if ! node "${RUNTIME_CONFIG_RENDERER}" \
    --environment dev \
    --format shell-export > "${RUNTIME_CONFIG_FILE}"
  then
    fail "Unable to render tracked DEV runtime configuration"
  fi
}

render_secret_package() {
  CANDIDATE_RENDER_DIR="${SYNC_WORK_DIR}/package-render"
  local renderer_args=(
    render
    --environment dev
    --version "${PACKAGE_VERSION}"
    --project-id "${PROJECT_ID}"
    --output-dir "${CANDIDATE_RENDER_DIR}"
  )
  if [[ -n "${PAYLOAD_FILE}" ]]; then
    renderer_args+=(--payload-file "${PAYLOAD_FILE}")
  fi

  if [[ -n "${RENDERER_CREDENTIAL_FILE}" && -z "${PAYLOAD_FILE}" ]]; then
    if ! CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="${RENDERER_CREDENTIAL_FILE}" \
      node "${SECRET_PACKAGE_CLI}" "${renderer_args[@]}" >/dev/null
    then
      fail "Unable to render the exact DEV secret package version"
    fi
  elif ! node "${SECRET_PACKAGE_CLI}" "${renderer_args[@]}" >/dev/null; then
    fail "Unable to render the exact DEV secret package version"
  fi

  PACKAGE_ENV_FILE="${CANDIDATE_RENDER_DIR}/current/environment.env"
  PACKAGE_GITHUB_KEY_FILE="${CANDIDATE_RENDER_DIR}/current/github-app-private-key.pem"
  PACKAGE_METADATA_FILE="${CANDIDATE_RENDER_DIR}/current/metadata.json"
  [[ -f "${PACKAGE_ENV_FILE}" ]] || fail "Rendered package environment file is unavailable"
  [[ -f "${PACKAGE_GITHUB_KEY_FILE}" ]] || fail "Rendered GitHub App PEM is unavailable"
  [[ -f "${PACKAGE_METADATA_FILE}" ]] || fail "Rendered package metadata is unavailable"
}

stage_envrc() {
  local registry_value="${REGISTRY:-${REGION_VALUE}-docker.pkg.dev/${PROJECT_ID}/intexuraos-dev}"
  ENVRC_TEMP_FILE="${SYNC_WORK_DIR}/candidate.envrc"
  : > "${ENVRC_TEMP_FILE}"
  chmod 600 "${ENVRC_TEMP_FILE}"

  {
    printf 'export PROJECT_ID=%q\n' "${PROJECT_ID}"
    printf 'export REGION=%q\n' "${REGION_VALUE}"
    printf 'export REGISTRY=%q\n' "${registry_value}"
    printf '\n# === TRACKED RUNTIME CONFIGURATION ===\n'
    cat "${RUNTIME_CONFIG_FILE}"
    printf '\n# === DEV SECRET PACKAGE (version %s) ===\n' "${PACKAGE_VERSION}"
    printf 'export INTEXURAOS_SECRET_PACKAGE_VERSION=%q\n' "${PACKAGE_VERSION}"
    PACKAGE_ENV_FILE_PATH="${PACKAGE_ENV_FILE}" node <<'NODE'
const { readFileSync } = require('node:fs');
const { parse } = require('dotenv');
const path = process.env.PACKAGE_ENV_FILE_PATH;
if (!path) process.exit(1);
const parsed = parse(readFileSync(path, 'utf8'));
const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
for (const name of Object.keys(parsed).sort()) {
  if (!/^INTEXURAOS_[A-Z0-9_]+$/u.test(name)) process.exit(2);
  process.stdout.write(`export ${name}=${shellQuote(parsed[name])}\n`);
}
NODE
    cat <<'EOF'

# === LOCAL OVERRIDES ===
# Load .envrc.local if exists (for local dev overrides)
[[ -f .envrc.local ]] && source .envrc.local || true
EOF
  } > "${ENVRC_TEMP_FILE}"
  chmod 600 "${ENVRC_TEMP_FILE}"
}

promote_local_artifacts() {
  node "${SECRET_PROJECTION_PROMOTER}" \
    --package-output-dir "${PROJECTION_OUTPUT_DIR}" \
    --candidate-package-dir "$(cd "$(dirname "${PACKAGE_ENV_FILE}")" && pwd -P)" \
    --candidate-envrc "${ENVRC_TEMP_FILE}" \
    --envrc-output "${ENVRC_FILE}" \
    --github-key-output "${GITHUB_KEY_OUTPUT}" \
    --version "${PACKAGE_VERSION}" \
    || fail "Unable to promote the complete DEV secret projection"
}

main() {
  parse_args "$@"
  umask 077
  command -v node >/dev/null 2>&1 || fail "node is required for package rendering"
  resolve_package_version
  resolve_project_id
  validate_inputs
  acquire_sync_lock
  render_tracked_config
  render_secret_package
  stage_envrc
  promote_local_artifacts

  echo "Rendered DEV secret package version ${PACKAGE_VERSION}."
  echo "Updated ${ENVRC_FILE}."
  echo "Updated ${GITHUB_KEY_OUTPUT}."
}

main "$@"
