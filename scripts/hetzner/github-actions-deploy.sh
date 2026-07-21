#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

HETZNER_PROD_HOST="${HETZNER_PROD_HOST:-162.55.210.48}"
REMOTE_USER="${REMOTE_USER:-deploy}"
REMOTE_REPO_DIR="${REMOTE_REPO_DIR:-/opt/intexuraos}"
PUBLIC_DOMAIN="${PUBLIC_DOMAIN:-intexuraos.cloud}"
SSH_PORT="${SSH_PORT:-22}"
DEPLOY_NGINX="${DEPLOY_NGINX:-true}"
DEPLOYMENT_JSON_PATH="/var/www/intexuraos/web/dist/deployment.json"
KEY_FILE=""
KNOWN_HOSTS_FILE=""
SYNC_SOURCE_DIR=""
DEPLOYMENT_RESPONSE_HEADERS_FILE=""
LOCAL_COMMIT_SHA_VALUE=""
COMMIT_SHA_VALUE=""
COMMIT_MESSAGE_VALUE=""
WORKFLOW_RUN_ID_VALUE="manual"
DEPLOYMENT_METADATA_PUBLISHED="false"
DEPLOYMENT_ATTESTATION_VERIFIED="false"
RETIRED_REMOTE_PATHS=(
  "packages/infra-otel"
)

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

cleanup() {
  local exit_status=$?

  set +e
  if [[ "${DEPLOYMENT_METADATA_PUBLISHED}" == "true" && "${DEPLOYMENT_ATTESTATION_VERIFIED}" != "true" ]]; then
    if ! withdraw_deployment_metadata; then
      printf 'ERROR: Could not withdraw unverified deployment attestation\n' >&2
    fi
  fi
  [[ -n "${KEY_FILE}" ]] && rm -f "${KEY_FILE}"
  [[ -n "${KNOWN_HOSTS_FILE}" ]] && rm -f "${KNOWN_HOSTS_FILE}"
  [[ -n "${DEPLOYMENT_RESPONSE_HEADERS_FILE}" ]] && rm -f "${DEPLOYMENT_RESPONSE_HEADERS_FILE}"
  if [[ -n "${SYNC_SOURCE_DIR}" && -d "${SYNC_SOURCE_DIR}" ]]; then
    rm -rf -- "${SYNC_SOURCE_DIR}"
  fi
  return "${exit_status}"
}

require_command() {
  local command_name="$1"
  command -v "${command_name}" >/dev/null 2>&1 || fail "${command_name} is required"
}

validate_inputs() {
  [[ -n "${HETZNER_DEPLOY_SSH_PRIVATE_KEY:-}" ]] \
    || fail "HETZNER_DEPLOY_SSH_PRIVATE_KEY is required"
  [[ -n "${HETZNER_PROD_HOST}" ]] || fail "HETZNER_PROD_HOST is required"
  [[ -n "${REMOTE_USER}" ]] || fail "REMOTE_USER is required"
  [[ -n "${REMOTE_REPO_DIR}" ]] || fail "REMOTE_REPO_DIR is required"
  [[ "${SSH_PORT}" =~ ^[0-9]+$ ]] || fail "SSH_PORT must be numeric"

  case "${DEPLOY_NGINX}" in
    true|false) ;;
    *) fail "DEPLOY_NGINX must be true or false" ;;
  esac
}

resolve_commit_metadata() {
  local worktree_status=""

  LOCAL_COMMIT_SHA_VALUE="$(git rev-parse HEAD)"
  worktree_status="$(git status --porcelain=v1 --untracked-files=all)"

  if [[ -n "${worktree_status}" ]]; then
    fail "Local checkout contains tracked or untracked changes"
  fi

  if [[ -n "${GITHUB_SHA:-}" && "${LOCAL_COMMIT_SHA_VALUE}" != "${GITHUB_SHA}" ]]; then
    fail "Local checkout SHA does not match GITHUB_SHA"
  fi

  COMMIT_SHA_VALUE="${GITHUB_SHA:-${LOCAL_COMMIT_SHA_VALUE}}"
  COMMIT_MESSAGE_VALUE="${GITHUB_COMMIT_MESSAGE:-}"
  if [[ -n "${GITHUB_RUN_ID:-}" ]]; then
    WORKFLOW_RUN_ID_VALUE="${GITHUB_RUN_ID}"
  fi

  if [[ -z "${COMMIT_MESSAGE_VALUE}" ]]; then
    COMMIT_MESSAGE_VALUE="$(git log -1 --pretty=%s)"
  fi

  [[ -n "${COMMIT_SHA_VALUE}" ]] || fail "Could not resolve COMMIT_SHA"
  [[ -n "${COMMIT_MESSAGE_VALUE}" ]] || fail "Could not resolve COMMIT_MESSAGE"
  [[ "${COMMIT_SHA_VALUE}" =~ ^[0-9a-f]{40}$ ]] || fail "COMMIT_SHA must be a 40-character lowercase hexadecimal SHA"
  [[ "${WORKFLOW_RUN_ID_VALUE}" == "manual" || "${WORKFLOW_RUN_ID_VALUE}" =~ ^[0-9]+$ ]] \
    || fail "GITHUB_RUN_ID must be numeric"
}

prepare_sync_source() {
  SYNC_SOURCE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/intexuraos-deploy-tree.XXXXXX")"
  git archive "${COMMIT_SHA_VALUE}" | tar -xf - -C "${SYNC_SOURCE_DIR}"
}

setup_ssh() {
  KEY_FILE="$(mktemp "${TMPDIR:-/tmp}/intexuraos-hetzner-key.XXXXXX")"
  KNOWN_HOSTS_FILE="$(mktemp "${TMPDIR:-/tmp}/intexuraos-hetzner-known-hosts.XXXXXX")"
  chmod 600 "${KEY_FILE}" "${KNOWN_HOSTS_FILE}"

  printf '%s\n' "${HETZNER_DEPLOY_SSH_PRIVATE_KEY}" | tr -d '\r' > "${KEY_FILE}"
  chmod 600 "${KEY_FILE}"

  ssh-keyscan -p "${SSH_PORT}" -H "${HETZNER_PROD_HOST}" >> "${KNOWN_HOSTS_FILE}"
}

ssh_command_string() {
  printf 'ssh -i %q -p %q -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=%q' \
    "${KEY_FILE}" \
    "${SSH_PORT}" \
    "${KNOWN_HOSTS_FILE}"
}

run_remote() {
  local command="$1"
  local quoted_repo_dir=""

  printf -v quoted_repo_dir '%q' "${REMOTE_REPO_DIR}"
  ssh -i "${KEY_FILE}" \
    -p "${SSH_PORT}" \
    -o BatchMode=yes \
    -o StrictHostKeyChecking=yes \
    -o UserKnownHostsFile="${KNOWN_HOSTS_FILE}" \
    "${REMOTE_USER}@${HETZNER_PROD_HOST}" \
    "cd ${quoted_repo_dir} && ${command}"
}

sync_repo() {
  local ssh_command=""

  ssh_command="$(ssh_command_string)"
  rsync -az --delete \
    --exclude '.git/' \
    --exclude '.terraform/' \
    --exclude '.env*' \
    --exclude 'node_modules/' \
    --exclude 'dist/' \
    --exclude 'coverage/' \
    --exclude '*.tfstate' \
    --exclude '*.tfstate.*' \
    -e "${ssh_command}" \
    "${SYNC_SOURCE_DIR%/}/" "${REMOTE_USER}@${HETZNER_PROD_HOST}:${REMOTE_REPO_DIR%/}/"
}

cleanup_retired_remote_paths() {
  local path=""
  local path_quoted=""

  for path in "${RETIRED_REMOTE_PATHS[@]}"; do
    printf -v path_quoted '%q' "${path}"
    run_remote "if [[ -e ${path_quoted} || -L ${path_quoted} ]]; then printf 'Removing retired remote path: %s\n' ${path_quoted}; rm -rf -- ${path_quoted}; fi"
  done
}

withdraw_deployment_metadata() {
  local deployment_path_quoted=""

  printf -v deployment_path_quoted '%q' "${DEPLOYMENT_JSON_PATH}"
  run_remote "rm -f -- ${deployment_path_quoted}"
}

run_remote_deploy_web() {
  local commit_sha_quoted=""
  local commit_message_quoted=""

  printf -v commit_sha_quoted '%q' "${COMMIT_SHA_VALUE}"
  printf -v commit_message_quoted '%q' "${COMMIT_MESSAGE_VALUE}"
  run_remote "COMMIT_SHA=${commit_sha_quoted} COMMIT_MESSAGE=${commit_message_quoted} INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/deploy-web.sh"
}

deploy_runtime() {
  run_remote 'sudo -n INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/load-secrets.sh'
  run_remote 'sudo -n INTEXURAOS_ENVIRONMENT=prod bash scripts/observability/install-grafana-alloy.sh'
  run_remote 'sudo -n INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/install-pm2-logrotate.sh'
  run_remote 'CI=true pnpm install --frozen-lockfile'
  run_remote 'INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/reload-pm2.sh'
}

deploy_web_and_edge() {
  run_remote_deploy_web

  if [[ "${DEPLOY_NGINX}" == "true" ]]; then
    run_remote 'sudo -n INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/deploy-nginx.sh'
  fi
}

verify_backend_readiness() {
  run_remote 'curl --fail --silent --show-error --max-time 10 http://127.0.0.1/api/whatsapp/health >/dev/null'
  curl --fail --silent --show-error --max-time 15 \
    --resolve "${PUBLIC_DOMAIN}:443:${HETZNER_PROD_HOST}" \
    "https://${PUBLIC_DOMAIN}/api/whatsapp/health" >/dev/null
}

publish_deployment_metadata() {
  local deployed_at=""
  local deployment_json=""
  local deployment_json_quoted=""
  local deployment_path_quoted=""
  local remote_publish_command=""

  deployed_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  printf -v deployment_json \
    '{"commitSha":"%s","workflowRunId":"%s","deployedAt":"%s"}' \
    "${COMMIT_SHA_VALUE}" \
    "${WORKFLOW_RUN_ID_VALUE}" \
    "${deployed_at}"
  printf -v deployment_json_quoted '%q' "${deployment_json}"
  printf -v deployment_path_quoted '%q' "${DEPLOYMENT_JSON_PATH}"

  IFS= read -r -d '' remote_publish_command <<'REMOTE_COMMAND' || true
deployment_tmp="$(mktemp "${DEPLOYMENT_JSON_PATH}.XXXXXX")"
trap "rm -f -- \"${deployment_tmp}\"" EXIT
printf "%s" "${DEPLOYMENT_JSON}" > "${deployment_tmp}"
chmod 644 "${deployment_tmp}"
mv -f -- "${deployment_tmp}" "${DEPLOYMENT_JSON_PATH}"
trap - EXIT
REMOTE_COMMAND

  DEPLOYMENT_METADATA_PUBLISHED="true"
  run_remote "DEPLOYMENT_JSON_PATH=${deployment_path_quoted}; DEPLOYMENT_JSON=${deployment_json_quoted}; ${remote_publish_command}"
}

verify_non_404_route() {
  local route_path="$1"
  local status=""

  status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 15 \
    --request POST \
    --resolve "${PUBLIC_DOMAIN}:443:${HETZNER_PROD_HOST}" \
    "https://${PUBLIC_DOMAIN}${route_path}")"

  if [[ "${status}" == "404" ]]; then
    fail "Code-agent callback route returned 404: ${route_path}"
  fi
}

verify_deployment_document() {
  local label="$1"
  local url="$2"
  local response=""
  shift 2

  DEPLOYMENT_RESPONSE_HEADERS_FILE="$(mktemp "${TMPDIR:-/tmp}/intexuraos-deployment-headers.XXXXXX")"

  if ! response="$(curl --fail --silent --show-error --max-time 15 \
    --dump-header "${DEPLOYMENT_RESPONSE_HEADERS_FILE}" \
    "$@" "${url}")"; then
    fail "Could not read deployment attestation through ${label}"
  fi

  if ! node scripts/hetzner/verify-deployment-document.mjs \
    "${COMMIT_SHA_VALUE}" \
    "${WORKFLOW_RUN_ID_VALUE}" \
    "${DEPLOYMENT_RESPONSE_HEADERS_FILE}" <<< "${response}"; then
    fail "Deployment attestation or response headers did not match the exact release contract through ${label}"
  fi

  rm -f "${DEPLOYMENT_RESPONSE_HEADERS_FILE}"
  DEPLOYMENT_RESPONSE_HEADERS_FILE=""
}

verify_runtime_readiness() {
  run_remote 'curl --fail --silent --show-error --max-time 10 http://127.0.0.1/healthz >/dev/null'
  curl --fail --silent --show-error --max-time 15 \
    --resolve "${PUBLIC_DOMAIN}:443:${HETZNER_PROD_HOST}" \
    "https://${PUBLIC_DOMAIN}/healthz" >/dev/null
  curl --fail --silent --show-error --max-time 15 \
    --resolve "${PUBLIC_DOMAIN}:443:${HETZNER_PROD_HOST}" \
    "https://${PUBLIC_DOMAIN}/api/user/health" >/dev/null
  curl --fail --silent --show-error --max-time 15 \
    --resolve "${PUBLIC_DOMAIN}:443:${HETZNER_PROD_HOST}" \
    "https://${PUBLIC_DOMAIN}/api/settings/health" >/dev/null
  curl --fail --silent --show-error --max-time 15 \
    --resolve "${PUBLIC_DOMAIN}:443:${HETZNER_PROD_HOST}" \
    "https://${PUBLIC_DOMAIN}/api/whatsapp/health" >/dev/null
  curl --fail --silent --show-error --max-time 15 \
    "https://${PUBLIC_DOMAIN}/api/whatsapp/health" >/dev/null
  verify_non_404_route "/api/code/internal/logs"
}

verify_deployment_attestation() {
  verify_deployment_document \
    "direct origin" \
    "https://${PUBLIC_DOMAIN}/deployment.json" \
    --resolve "${PUBLIC_DOMAIN}:443:${HETZNER_PROD_HOST}"
  verify_deployment_document \
    "public DNS" \
    "https://${PUBLIC_DOMAIN}/deployment.json"
}

main() {
  trap cleanup EXIT
  require_command curl
  require_command rsync
  require_command ssh
  require_command ssh-keyscan
  require_command git
  require_command node
  require_command tar
  validate_inputs
  resolve_commit_metadata
  prepare_sync_source
  setup_ssh
  withdraw_deployment_metadata
  sync_repo
  cleanup_retired_remote_paths
  deploy_runtime
  verify_backend_readiness
  deploy_web_and_edge
  verify_runtime_readiness
  publish_deployment_metadata
  verify_deployment_attestation
  DEPLOYMENT_ATTESTATION_VERIFIED="true"

  printf 'Hetzner production deployment completed for %s\n' "${PUBLIC_DOMAIN}"
}

main "$@"
