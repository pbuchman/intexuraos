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

deploy_runtime() {
  run_remote 'sudo -n INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/load-secrets.sh'
  run_remote 'CI=true pnpm install --frozen-lockfile'
  run_remote 'pnpm --filter @intexuraos/infra-otel build'
  run_remote 'INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/deploy-web.sh'
  run_remote 'INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/reload-pm2.sh'

  if [[ "${DEPLOY_NGINX}" == "true" ]]; then
    run_remote 'sudo -n INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/deploy-nginx.sh'
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
}

main() {
  trap cleanup EXIT
  require_command curl
  require_command rsync
  require_command ssh
  require_command ssh-keyscan
  validate_inputs
  setup_ssh
  sync_repo
  deploy_runtime
  verify_deployment

  printf 'Hetzner production deployment completed for %s\n' "${PUBLIC_DOMAIN}"
}

main "$@"
