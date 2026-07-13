#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

HETZNER_PROD_HOST="${HETZNER_PROD_HOST:-162.55.210.48}"
REMOTE_USER="${REMOTE_USER:-deploy}"
REMOTE_REPO_DIR="${REMOTE_REPO_DIR:-/opt/intexuraos}"
PUBLIC_DOMAIN="${PUBLIC_DOMAIN:-intexuraos.cloud}"
SSH_PORT="${SSH_PORT:-22}"
DEPLOY_NGINX="${DEPLOY_NGINX:-true}"
KEY_FILE=""
KNOWN_HOSTS_FILE=""
COMMIT_SHA_VALUE=""
COMMIT_MESSAGE_VALUE=""
RETIRED_REMOTE_PATHS=(
  "packages/infra-otel"
)

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

cleanup() {
  [[ -n "${KEY_FILE}" ]] && rm -f "${KEY_FILE}"
  [[ -n "${KNOWN_HOSTS_FILE}" ]] && rm -f "${KNOWN_HOSTS_FILE}"
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
  COMMIT_SHA_VALUE="${GITHUB_SHA:-}"
  COMMIT_MESSAGE_VALUE="${GITHUB_COMMIT_MESSAGE:-}"

  if [[ -z "${COMMIT_SHA_VALUE}" ]]; then
    COMMIT_SHA_VALUE="$(git rev-parse HEAD)"
  fi

  if [[ -z "${COMMIT_MESSAGE_VALUE}" ]]; then
    COMMIT_MESSAGE_VALUE="$(git log -1 --pretty=%s)"
  fi

  [[ -n "${COMMIT_SHA_VALUE}" ]] || fail "Could not resolve COMMIT_SHA"
  [[ -n "${COMMIT_MESSAGE_VALUE}" ]] || fail "Could not resolve COMMIT_MESSAGE"
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
    ./ "${REMOTE_USER}@${HETZNER_PROD_HOST}:${REMOTE_REPO_DIR%/}/"
}

cleanup_retired_remote_paths() {
  local path=""
  local path_quoted=""

  for path in "${RETIRED_REMOTE_PATHS[@]}"; do
    printf -v path_quoted '%q' "${path}"
    run_remote "if [[ -e ${path_quoted} || -L ${path_quoted} ]]; then printf 'Removing retired remote path: %s\n' ${path_quoted}; rm -rf -- ${path_quoted}; fi"
  done
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
  run_remote_deploy_web
  run_remote 'INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/reload-pm2.sh'

  if [[ "${DEPLOY_NGINX}" == "true" ]]; then
    run_remote 'sudo -n INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/deploy-nginx.sh'
  fi
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

verify_deployment() {
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
  verify_non_404_route "/api/code/internal/logs"
}

main() {
  trap cleanup EXIT
  require_command curl
  require_command rsync
  require_command ssh
  require_command ssh-keyscan
  require_command git
  validate_inputs
  resolve_commit_metadata
  setup_ssh
  sync_repo
  cleanup_retired_remote_paths
  deploy_runtime
  verify_deployment

  printf 'Hetzner production deployment completed for %s\n' "${PUBLIC_DOMAIN}"
}

main "$@"
