#!/usr/bin/env bash
# Render the exact DEV secret package, merge it with tracked runtime config,
# and atomically publish the local .envrc and GitHub App private key.

set -euo pipefail

SCRIPT_NAME="$(basename "$0")"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SECRET_PACKAGE_CLI="${REPO_ROOT}/scripts/secret-package.mjs"
RUNTIME_CONFIG_RENDERER="${REPO_ROOT}/scripts/render-runtime-config.mjs"

ENVIRONMENT="dev"
CLI_PROJECT_ID=""
CLI_PACKAGE_VERSION=""
ENVRC_FILE="${REPO_ROOT}/.envrc"
PACKAGE_OUTPUT_DIR="${SECRET_PACKAGE_RENDER_DIR:-${INTEXURAOS_SECRET_PACKAGE_ROOT:-${HOME}/.config/intexuraos/secret-packages/dev}}"
GITHUB_KEY_OUTPUT="${GITHUB_APP_PRIVATE_KEY_PATH:-${HOME}/.code-orchestrator/github-app.pem}"
PAYLOAD_FILE=""
REGION_VALUE="${REGION:-europe-central2}"
RENDERER_CREDENTIAL_FILE="${SECRET_PACKAGE_GOOGLE_APPLICATION_CREDENTIALS:-}"

RUNTIME_CONFIG_FILE=""
ENVRC_TEMP_FILE=""
GITHUB_KEY_TEMP_FILE=""
TRANSACTION_DIR=""
TRANSACTION_ACTIVE=0
PREVIOUS_PACKAGE_CURRENT_PRESENT=0
PREVIOUS_PACKAGE_CURRENT_TARGET=""
PREVIOUS_ENVRC_PRESENT=0
PREVIOUS_GITHUB_KEY_PRESENT=0

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
  --package-output-dir <path>      Private package render root
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

  if [[ ${TRANSACTION_ACTIVE} -eq 1 && ${exit_code} -ne 0 ]]; then
    if ! rollback_local_transaction; then
      echo "ERROR: Local secret-package transaction rollback failed" >&2
      exit_code=1
    fi
  fi
  if [[ -n "${RUNTIME_CONFIG_FILE}" && -f "${RUNTIME_CONFIG_FILE}" ]]; then
    rm -f "${RUNTIME_CONFIG_FILE}"
  fi
  if [[ -n "${ENVRC_TEMP_FILE}" && -f "${ENVRC_TEMP_FILE}" ]]; then
    rm -f "${ENVRC_TEMP_FILE}"
  fi
  if [[ -n "${GITHUB_KEY_TEMP_FILE}" && -f "${GITHUB_KEY_TEMP_FILE}" ]]; then
    rm -f "${GITHUB_KEY_TEMP_FILE}"
  fi
  if [[ -n "${TRANSACTION_DIR}" ]]; then
    rm -rf "${TRANSACTION_DIR}"
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
        PACKAGE_OUTPUT_DIR="$2"
        shift 2
        ;;
      --package-output-dir=*|--output-dir=*)
        PACKAGE_OUTPUT_DIR="${1#*=}"
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
  [[ -n "${PACKAGE_OUTPUT_DIR}" ]] || fail "--package-output-dir must not be empty"
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

render_tracked_config() {
  RUNTIME_CONFIG_FILE="$(mktemp "${TMPDIR:-/tmp}/intexuraos-runtime-config.XXXXXX")"
  chmod 600 "${RUNTIME_CONFIG_FILE}"
  if ! node "${RUNTIME_CONFIG_RENDERER}" \
    --environment dev \
    --format shell-export > "${RUNTIME_CONFIG_FILE}"
  then
    fail "Unable to render tracked DEV runtime configuration"
  fi
}

begin_local_transaction() {
  local current_path="${PACKAGE_OUTPUT_DIR}/current"

  [[ "${ENVRC_FILE}" != "${GITHUB_KEY_OUTPUT}" ]] \
    || fail ".envrc and GitHub App PEM outputs must be different paths"

  TRANSACTION_DIR="$(mktemp -d "${TMPDIR:-/tmp}/intexuraos-local-sync.XXXXXX")"
  chmod 700 "${TRANSACTION_DIR}"

  if [[ -L "${current_path}" ]]; then
    PREVIOUS_PACKAGE_CURRENT_PRESENT=1
    PREVIOUS_PACKAGE_CURRENT_TARGET="$(readlink "${current_path}")"
    if [[ ! "${PREVIOUS_PACKAGE_CURRENT_TARGET}" =~ ^dev-v[1-9][0-9]*-[0-9a-f]{8}$ ]]; then
      fail "Existing DEV package current link is invalid"
    fi
  elif [[ -e "${current_path}" ]]; then
    fail "Existing DEV package current path must be a renderer-managed symlink"
  fi

  if [[ -e "${ENVRC_FILE}" || -L "${ENVRC_FILE}" ]]; then
    [[ -f "${ENVRC_FILE}" && ! -L "${ENVRC_FILE}" ]] \
      || fail "Existing .envrc output must be a regular file"
    cp "${ENVRC_FILE}" "${TRANSACTION_DIR}/envrc.previous"
    chmod 600 "${TRANSACTION_DIR}/envrc.previous"
    PREVIOUS_ENVRC_PRESENT=1
  fi

  if [[ -e "${GITHUB_KEY_OUTPUT}" || -L "${GITHUB_KEY_OUTPUT}" ]]; then
    [[ -f "${GITHUB_KEY_OUTPUT}" && ! -L "${GITHUB_KEY_OUTPUT}" ]] \
      || fail "Existing GitHub App PEM output must be a regular file"
    cp "${GITHUB_KEY_OUTPUT}" "${TRANSACTION_DIR}/github-key.previous"
    chmod 600 "${TRANSACTION_DIR}/github-key.previous"
    PREVIOUS_GITHUB_KEY_PRESENT=1
  fi

  TRANSACTION_ACTIVE=1
}

rollback_local_transaction() {
  node --input-type=module - \
    "${PACKAGE_OUTPUT_DIR}/current" \
    "${PREVIOUS_PACKAGE_CURRENT_PRESENT}" \
    "${PREVIOUS_PACKAGE_CURRENT_TARGET}" \
    "${ENVRC_FILE}" \
    "${PREVIOUS_ENVRC_PRESENT}" \
    "${TRANSACTION_DIR}/envrc.previous" \
    "${GITHUB_KEY_OUTPUT}" \
    "${PREVIOUS_GITHUB_KEY_PRESENT}" \
    "${TRANSACTION_DIR}/github-key.previous" <<'NODE'
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  renameSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';

const [
  currentPath,
  previousCurrentPresent,
  previousCurrentTarget,
  envrcPath,
  previousEnvrcPresent,
  envrcBackup,
  githubKeyPath,
  previousGithubKeyPresent,
  githubKeyBackup,
] = process.argv.slice(2);

function restoreFile(path, present, backup) {
  if (present !== '1') {
    rmSync(path, { force: true });
    return;
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.rollback-${process.pid}-${randomUUID()}`;
  try {
    copyFileSync(backup, temporaryPath);
    chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, path);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

if (previousCurrentPresent === '1') {
  const temporaryLink = `${currentPath}.rollback-${process.pid}-${randomUUID()}`;
  try {
    symlinkSync(previousCurrentTarget, temporaryLink, 'dir');
    renameSync(temporaryLink, currentPath);
  } finally {
    rmSync(temporaryLink, { force: true });
  }
} else {
  rmSync(currentPath, { force: true });
}
restoreFile(envrcPath, previousEnvrcPresent, envrcBackup);
restoreFile(githubKeyPath, previousGithubKeyPresent, githubKeyBackup);
NODE
}

commit_local_transaction() {
  TRANSACTION_ACTIVE=0
}

render_secret_package() {
  local renderer_args=(
    render
    --environment dev
    --version "${PACKAGE_VERSION}"
    --project-id "${PROJECT_ID}"
    --output-dir "${PACKAGE_OUTPUT_DIR}"
  )
  if [[ -n "${PAYLOAD_FILE}" ]]; then
    renderer_args+=(--payload-file "${PAYLOAD_FILE}")
  fi

  mkdir -p "${PACKAGE_OUTPUT_DIR}"
  chmod 700 "${PACKAGE_OUTPUT_DIR}"
  if [[ -n "${RENDERER_CREDENTIAL_FILE}" && -z "${PAYLOAD_FILE}" ]]; then
    if ! CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="${RENDERER_CREDENTIAL_FILE}" \
      node "${SECRET_PACKAGE_CLI}" "${renderer_args[@]}" >/dev/null
    then
      fail "Unable to render the exact DEV secret package version"
    fi
  elif ! node "${SECRET_PACKAGE_CLI}" "${renderer_args[@]}" >/dev/null; then
    fail "Unable to render the exact DEV secret package version"
  fi

  PACKAGE_ENV_FILE="${PACKAGE_OUTPUT_DIR}/current/environment.env"
  PACKAGE_GITHUB_KEY_FILE="${PACKAGE_OUTPUT_DIR}/current/github-app-private-key.pem"
  [[ -f "${PACKAGE_ENV_FILE}" ]] || fail "Rendered package environment file is unavailable"
  [[ -f "${PACKAGE_GITHUB_KEY_FILE}" ]] || fail "Rendered GitHub App PEM is unavailable"
}

stage_envrc() {
  local output_directory
  local registry_value="${REGISTRY:-${REGION_VALUE}-docker.pkg.dev/${PROJECT_ID}/intexuraos-dev}"
  output_directory="$(dirname "${ENVRC_FILE}")"
  mkdir -p "${output_directory}"
  ENVRC_TEMP_FILE="$(mktemp "${ENVRC_FILE}.tmp.XXXXXX")"
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

stage_github_key() {
  local output_directory
  output_directory="$(dirname "${GITHUB_KEY_OUTPUT}")"
  mkdir -p "${output_directory}"
  chmod 700 "${output_directory}"
  GITHUB_KEY_TEMP_FILE="$(mktemp "${GITHUB_KEY_OUTPUT}.tmp.XXXXXX")"
  cp "${PACKAGE_GITHUB_KEY_FILE}" "${GITHUB_KEY_TEMP_FILE}"
  chmod 600 "${GITHUB_KEY_TEMP_FILE}"
}

publish_local_artifacts() {
  mv -f "${GITHUB_KEY_TEMP_FILE}" "${GITHUB_KEY_OUTPUT}"
  GITHUB_KEY_TEMP_FILE=""
  chmod 600 "${GITHUB_KEY_OUTPUT}"

  mv -f "${ENVRC_TEMP_FILE}" "${ENVRC_FILE}"
  ENVRC_TEMP_FILE=""
  chmod 600 "${ENVRC_FILE}"
}

main() {
  parse_args "$@"
  umask 077
  command -v node >/dev/null 2>&1 || fail "node is required for package rendering"
  resolve_package_version
  resolve_project_id
  validate_inputs
  render_tracked_config
  begin_local_transaction
  render_secret_package
  stage_envrc
  stage_github_key
  publish_local_artifacts
  commit_local_transaction

  echo "Rendered DEV secret package version ${PACKAGE_VERSION}."
  echo "Updated ${ENVRC_FILE}."
  echo "Updated ${GITHUB_KEY_OUTPUT}."
}

main "$@"
