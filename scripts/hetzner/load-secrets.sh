#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
RUNTIME_CONFIG_RENDERER="${REPO_ROOT}/scripts/render-runtime-config.mjs"
PROJECT_ID="${PROJECT_ID:-intexuraos-dev-pbuchman}"
REGION="${REGION:-europe-central2}"
OUTPUT_FILE="${OUTPUT_FILE:-/etc/intexuraos/.env.prod}"
PROVISIONER_SA_KEY_FILE="${PROVISIONER_SA_KEY_FILE:-${GOOGLE_APPLICATION_CREDENTIALS:-/home/deploy/provisioner-sa-key.json}}"
RUNTIME_SA_KEY_FILE="${RUNTIME_SA_KEY_FILE:-/home/deploy/runtime-sa-key.json}"
INTERNAL_AUTH_TOKEN_FILE="${INTERNAL_AUTH_TOKEN_FILE:-/etc/intexuraos/internal-auth-token}"
PUBLIC_ORIGIN="${PUBLIC_ORIGIN:-https://intexuraos.cloud}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
NGINX_TOKEN_GROUP="${NGINX_TOKEN_GROUP:-www-data}"
TEMP_ENV_FILE=""
RUNTIME_CONFIG_FILE=""
BLOCKED_SECRET_NAMES_FILE=""
POLICY_SECRET_NAMES_FILE=""
STAGED_INTERNAL_AUTH_TOKEN_FILE=""

declare -a REQUESTED_SECRETS=()
HETZNER_RUNTIME_SECRETS=(
  INTEXURAOS_CLOUDFLARE_API_TOKEN
  INTEXURAOS_ENCRYPTION_KEY
  INTEXURAOS_GRAFANA_CLOUD_LOKI_TOKEN
  INTEXURAOS_GITHUB_OAUTH_CLIENT_SECRET
  INTEXURAOS_GITHUB_WEBHOOK_SECRET
  INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET
  INTEXURAOS_INTERNAL_AUTH_TOKEN
  INTEXURAOS_MATRIX_CORPUS_BINDING_HMAC_KEY
  INTEXURAOS_MATRIX_CORPUS_CONTEXT_ENCRYPTION_KEY
  INTEXURAOS_MATRIX_CORPUS_EVALUATOR_USER_ID
  INTEXURAOS_MATRIX_CORPUS_MATRIX_ROOM_BINDING
  INTEXURAOS_MATRIX_CORPUS_SIGNING_PRIVATE_KEY
  INTEXURAOS_MATRIX_CORPUS_WHATSAPP_ACCOUNT_BINDING
  INTEXURAOS_MATRIX_CORPUS_WHATSAPP_SENDER_BINDING
  INTEXURAOS_MATRIX_OUTBOUND_ADAPTER_AUTH_TOKEN
  INTEXURAOS_OPENAI_APP_API_KEY
  INTEXURAOS_OPENROUTER_APP_API_KEY
  INTEXURAOS_ORCHESTRATOR_SECRET
  INTEXURAOS_SENTRY_WEBHOOK_SECRET
  INTEXURAOS_SENTRY_AUTOMATION_USER_ID
  INTEXURAOS_TOKEN_ENCRYPTION_KEY
  INTEXURAOS_WEBHOOK_VERIFY_SECRET
  INTEXURAOS_WHATSAPP_ACCESS_TOKEN
  INTEXURAOS_WHATSAPP_APP_SECRET
  INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID
  INTEXURAOS_WHATSAPP_VERIFY_TOKEN
  INTEXURAOS_WHATSAPP_WABA_ID
)

usage() {
  printf 'Usage: INTEXURAOS_ENVIRONMENT=prod %s [--output path] [--project-id id] [--secret NAME]\n' "$(basename "$0")"
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

cleanup_temp_file() {
  if [[ -n "${TEMP_ENV_FILE:-}" ]]; then
    rm -f "${TEMP_ENV_FILE}"
  fi
  if [[ -n "${RUNTIME_CONFIG_FILE:-}" ]]; then
    rm -f "${RUNTIME_CONFIG_FILE}"
  fi
  if [[ -n "${BLOCKED_SECRET_NAMES_FILE:-}" ]]; then
    rm -f "${BLOCKED_SECRET_NAMES_FILE}"
  fi
  if [[ -n "${POLICY_SECRET_NAMES_FILE:-}" ]]; then
    rm -f "${POLICY_SECRET_NAMES_FILE}"
  fi
  if [[ -n "${STAGED_INTERNAL_AUTH_TOKEN_FILE:-}" ]]; then
    rm -f "${STAGED_INTERNAL_AUTH_TOKEN_FILE}"
  fi
}

require_prod() {
  if [[ "${INTEXURAOS_ENVIRONMENT:-}" != "prod" ]]; then
    fail "Refusing to load secrets unless INTEXURAOS_ENVIRONMENT=prod"
  fi
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --output)
        shift
        [[ $# -gt 0 ]] || fail "--output requires a value"
        OUTPUT_FILE="$1"
        shift
        ;;
      --output=*)
        OUTPUT_FILE="${1#*=}"
        shift
        ;;
      --project-id)
        shift
        [[ $# -gt 0 ]] || fail "--project-id requires a value"
        PROJECT_ID="$1"
        shift
        ;;
      --project-id=*)
        PROJECT_ID="${1#*=}"
        shift
        ;;
      --secret)
        shift
        [[ $# -gt 0 ]] || fail "--secret requires a value"
        REQUESTED_SECRETS+=("$1")
        shift
        ;;
      --secret=*)
        REQUESTED_SECRETS+=("${1#*=}")
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        fail "Unknown argument: $1"
        ;;
    esac
  done
}

load_secret_names() {
  # --secret is a backwards-compatible assertion and must never narrow the refresh.
  printf '%s\n' "${HETZNER_RUNTIME_SECRETS[@]}" | sort -u
}

load_runtime_config() {
  RUNTIME_CONFIG_FILE="$(mktemp "${TMPDIR:-/tmp}/intexuraos-prod-config.XXXXXX")"
  BLOCKED_SECRET_NAMES_FILE="$(mktemp "${TMPDIR:-/tmp}/intexuraos-blocked-secret-names.XXXXXX")"
  POLICY_SECRET_NAMES_FILE="$(mktemp "${TMPDIR:-/tmp}/intexuraos-policy-secret-names.XXXXXX")"

  if ! node "${RUNTIME_CONFIG_RENDERER}" \
    --environment prod \
    --format dotenv > "${RUNTIME_CONFIG_FILE}"
  then
    fail "Unable to render tracked runtime configuration for prod"
  fi

  if ! node --input-type=module - \
    "${REPO_ROOT}/scripts/lib/runtime-config.mjs" \
    "${POLICY_SECRET_NAMES_FILE}" \
    > "${BLOCKED_SECRET_NAMES_FILE}" <<'NODE'
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const runtimeConfigModule = await import(pathToFileURL(process.argv[2]).href);
const policy = runtimeConfigModule.loadRuntimePolicy();
const blockedNames = [
  ...new Set([
    ...policy.scopes.common,
    ...policy.scopes.dev,
    ...policy.scopes.prod,
    ...policy.deleteOnlyNames,
  ]),
].sort();
process.stdout.write(`${blockedNames.join('\n')}\n`);
writeFileSync(process.argv[3], `${policy.secretManagerNames.join('\n')}\n`, { mode: 0o600 });
NODE
  then
    fail "Unable to load the runtime configuration policy"
  fi
  [[ -s "${BLOCKED_SECRET_NAMES_FILE}" ]] \
    || fail "Runtime configuration policy blocklist is empty"
  [[ -s "${POLICY_SECRET_NAMES_FILE}" ]] \
    || fail "Runtime configuration Secret Manager allowlist is empty"
}

is_blocked_secret_manager_name() {
  local name="$1"

  grep -qFx "${name}" "${BLOCKED_SECRET_NAMES_FILE}"
}

is_policy_secret_manager_name() {
  local name="$1"

  grep -qFx "${name}" "${POLICY_SECRET_NAMES_FILE}"
}

is_production_runtime_secret_name() {
  local name="$1"
  local allowed_name=""

  for allowed_name in "${HETZNER_RUNTIME_SECRETS[@]}"; do
    if [[ "${name}" == "${allowed_name}" ]]; then
      return 0
    fi
  done
  return 1
}

validate_default_secret_names() {
  local name=""
  local unique_count=""

  [[ ${#HETZNER_RUNTIME_SECRETS[@]} -eq 27 ]] \
    || fail "Production runtime secret allowlist must contain exactly 27 names"
  unique_count="$(printf '%s\n' "${HETZNER_RUNTIME_SECRETS[@]}" | sort -u | wc -l | tr -d ' ')"
  [[ "${unique_count}" == "${#HETZNER_RUNTIME_SECRETS[@]}" ]] \
    || fail "Production runtime secret allowlist contains duplicate names"

  for name in "${HETZNER_RUNTIME_SECRETS[@]}"; do
    validate_secret_name "${name}"
    if is_blocked_secret_manager_name "${name}"; then
      fail "${name} is both production runtime secret and blocked runtime configuration"
    fi
    if ! is_policy_secret_manager_name "${name}"; then
      fail "${name} is not classified as a Secret Manager secret"
    fi
  done
}

validate_requested_secrets() {
  local name=""

  for name in "${REQUESTED_SECRETS[@]}"; do
    validate_secret_name "${name}"
    if is_blocked_secret_manager_name "${name}"; then
      fail "${name} is blocked by runtime configuration policy and must not be read from Secret Manager"
    fi
    if ! is_policy_secret_manager_name "${name}"; then
      fail "${name} is not classified as a Secret Manager secret"
    fi
    if ! is_production_runtime_secret_name "${name}"; then
      fail "${name} is not in the production runtime secret allowlist"
    fi
  done
}

validate_secret_name() {
  local secret_name="$1"

  if [[ ! "${secret_name}" =~ ^INTEXURAOS_[A-Z0-9_]+$ ]]; then
    fail "Invalid Secret Manager name: ${secret_name}"
  fi
}

dotenv_escape() {
  local value="$1"

  value="${value//\\/\\\\}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  printf '"%s"' "${value}"
}

write_env_line() {
  local output_path="$1"
  local key="$2"
  local value="$3"

  printf '%s=%s\n' "${key}" "$(dotenv_escape "${value}")" >> "${output_path}"
}

write_header() {
  local output_path="$1"

  cat > "${output_path}" <<HEADER
# Generated by scripts/hetzner/load-secrets.sh.
# Do not edit by hand. Values are merged from tracked config and GCP Secret Manager.
HEADER
  write_env_line "${output_path}" "INTEXURAOS_ENVIRONMENT" "prod"
  write_env_line "${output_path}" "INTEXURAOS_RUNTIME" "prod"
  write_env_line "${output_path}" "INTEXURAOS_GCP_PROJECT_ID" "${PROJECT_ID}"
  write_env_line "${output_path}" "GOOGLE_CLOUD_PROJECT" "${PROJECT_ID}"
  write_env_line "${output_path}" "PROJECT_ID" "${PROJECT_ID}"
  write_env_line "${output_path}" "REGION" "${REGION}"
  write_env_line "${output_path}" "HETZNER_PROVISIONER_GOOGLE_APPLICATION_CREDENTIALS" "${PROVISIONER_SA_KEY_FILE}"
  write_env_line "${output_path}" "GOOGLE_APPLICATION_CREDENTIALS" "${RUNTIME_SA_KEY_FILE}"
  write_env_line "${output_path}" "INTEXURAOS_PUBLIC_ORIGIN" "${PUBLIC_ORIGIN}"
  write_env_line "${output_path}" "INTEXURAOS_WEB_APP_URL" "${PUBLIC_ORIGIN}"
  write_env_line "${output_path}" "INTEXURAOS_WEB_URL" "${PUBLIC_ORIGIN}"
  write_env_line "${output_path}" "INTEXURAOS_CODE_TASK_CALLBACK_BASE_URL" "${PUBLIC_ORIGIN}/api/code"
  write_env_line "${output_path}" "INTEXURAOS_SENTRY_CODE_TASK_REPOSITORY" "pbuchman/intexuraos"
  write_env_line "${output_path}" "INTEXURAOS_SENTRY_CODE_TASK_BASE_BRANCH" "development"
  write_env_line "${output_path}" "NODE_ENV" "production"
  printf '\n# Tracked non-secret runtime configuration.\n' >> "${output_path}"
  cat "${RUNTIME_CONFIG_FILE}" >> "${output_path}"
}

read_secret() {
  local secret_name="$1"

  gcloud secrets versions access latest \
    --secret="${secret_name}" \
    --project="${PROJECT_ID}"
}

stage_internal_auth_token() {
  local token="$1"

  STAGED_INTERNAL_AUTH_TOKEN_FILE="$(mktemp "${TMPDIR:-/tmp}/intexuraos-internal-auth.XXXXXX")"
  printf '%s' "${token}" > "${STAGED_INTERNAL_AUTH_TOKEN_FILE}"
  chmod 600 "${STAGED_INTERNAL_AUTH_TOKEN_FILE}"
}

install_internal_auth_token() {
  [[ -n "${STAGED_INTERNAL_AUTH_TOKEN_FILE}" ]] || return 0

  getent group "${NGINX_TOKEN_GROUP}" >/dev/null 2>&1 \
    || fail "Group ${NGINX_TOKEN_GROUP} is required before writing ${INTERNAL_AUTH_TOKEN_FILE}"

  install -d -m 755 "$(dirname "${INTERNAL_AUTH_TOKEN_FILE}")"
  install -m 640 -o root -g "${NGINX_TOKEN_GROUP}" \
    "${STAGED_INTERNAL_AUTH_TOKEN_FILE}" "${INTERNAL_AUTH_TOKEN_FILE}"
}

append_secret() {
  local output_path="$1"
  local secret_name="$2"
  local secret_value=""

  validate_secret_name "${secret_name}"

  printf 'Loading secret %s\n' "${secret_name}" >&2
  if ! secret_value="$(read_secret "${secret_name}")"; then
    fail "Unable to read Secret Manager value for ${secret_name}"
  fi

  write_env_line "${output_path}" "${secret_name}" "${secret_value}"

  if [[ "${secret_name}" == "INTEXURAOS_INTERNAL_AUTH_TOKEN" ]]; then
    stage_internal_auth_token "${secret_value}"
  fi
}

main() {
  parse_args "$@"
  require_prod

  command -v gcloud >/dev/null 2>&1 || fail "gcloud CLI is required"
  command -v node >/dev/null 2>&1 || fail "node is required for runtime configuration"
  id -u "${DEPLOY_USER}" >/dev/null 2>&1 || fail "Deploy user ${DEPLOY_USER} is required"

  if [[ -r "${PROVISIONER_SA_KEY_FILE}" ]]; then
    export CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="${PROVISIONER_SA_KEY_FILE}"
  fi

  umask 077

  local temp_file=""
  TEMP_ENV_FILE="$(mktemp "${TMPDIR:-/tmp}/intexuraos-prod-env.XXXXXX")"
  temp_file="${TEMP_ENV_FILE}"
  trap cleanup_temp_file EXIT

  load_runtime_config
  validate_default_secret_names
  validate_requested_secrets
  mapfile -t secret_names < <(load_secret_names)
  [[ ${#secret_names[@]} -gt 0 ]] || fail "No secrets selected"

  write_header "${temp_file}"

  local secret_name=""
  for secret_name in "${secret_names[@]}"; do
    append_secret "${temp_file}" "${secret_name}"
  done

  install -d -m 755 "$(dirname "${OUTPUT_FILE}")"
  install -m 600 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "${temp_file}" "${OUTPUT_FILE}"
  # Publish the nginx token only after all reads and the primary env install succeed.
  install_internal_auth_token

  printf 'Wrote %s with %s secrets (mode 600)\n' "${OUTPUT_FILE}" "${#secret_names[@]}"
  if [[ -n "${STAGED_INTERNAL_AUTH_TOKEN_FILE}" ]]; then
    printf 'Wrote %s for nginx internal-auth injection\n' "${INTERNAL_AUTH_TOKEN_FILE}"
  fi
}

main "$@"
