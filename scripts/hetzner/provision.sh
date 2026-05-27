#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PROJECT_ID="${PROJECT_ID:-intexuraos-dev-pbuchman}"
DOMAIN="${DOMAIN:-intexuraos.cloud}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/intexuraos}"
WEB_ROOT="${WEB_ROOT:-/var/www/intexuraos/web/dist}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
SKIP_CERTBOT=0
SKIP_SECRETS=0

usage() {
  printf 'Usage: INTEXURAOS_ENVIRONMENT=prod %s --email ops@example.com [--deploy-dir path] [--skip-certbot] [--skip-secrets]\n' "$(basename "$0")"
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

require_prod() {
  if [[ "${INTEXURAOS_ENVIRONMENT:-}" != "prod" ]]; then
    fail "INTEXURAOS_ENVIRONMENT must be prod"
  fi
}

require_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    fail "Run this script as root"
  fi
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --email)
        shift
        [[ $# -gt 0 ]] || fail "--email requires a value"
        CERTBOT_EMAIL="$1"
        shift
        ;;
      --email=*)
        CERTBOT_EMAIL="${1#*=}"
        shift
        ;;
      --deploy-dir)
        shift
        [[ $# -gt 0 ]] || fail "--deploy-dir requires a value"
        DEPLOY_DIR="$1"
        shift
        ;;
      --deploy-dir=*)
        DEPLOY_DIR="${1#*=}"
        shift
        ;;
      --skip-certbot)
        SKIP_CERTBOT=1
        shift
        ;;
      --skip-secrets)
        SKIP_SECRETS=1
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

install_base_packages() {
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y \
    ca-certificates \
    curl \
    fail2ban \
    git \
    gnupg \
    jq \
    nginx-extras \
    rsync \
    ufw
}

install_google_cloud_cli() {
  if command -v gcloud >/dev/null 2>&1; then
    return
  fi

  install -d -m 755 /usr/share/keyrings
  curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg \
    | gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg
  printf 'deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main\n' \
    > /etc/apt/sources.list.d/google-cloud-sdk.list

  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y google-cloud-cli
}

install_node_22() {
  if command -v node >/dev/null 2>&1 && [[ "$(node --version)" == v22.* ]]; then
    corepack enable
    npm install -g pm2
    return
  fi

  install -d -m 755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  printf 'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main\n' \
    > /etc/apt/sources.list.d/nodesource.list

  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
  corepack enable
  npm install -g pm2
}

prepare_user_and_directories() {
  if ! id -u "${DEPLOY_USER}" >/dev/null 2>&1; then
    useradd --create-home --shell /bin/bash "${DEPLOY_USER}"
  fi

  install -d -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" -m 755 "${DEPLOY_DIR}"
  install -d -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" -m 755 "${WEB_ROOT}"
  install -d -o root -g root -m 755 /etc/intexuraos
}

configure_firewall() {
  ufw allow OpenSSH
  ufw allow http
  ufw allow https
  ufw --force enable
}

configure_pm2_startup() {
  env PATH="/usr/local/bin:${PATH}" pm2 startup systemd -u "${DEPLOY_USER}" --hp "/home/${DEPLOY_USER}" || true
}

main() {
  parse_args "$@"
  require_prod
  require_root

  install_base_packages
  install_google_cloud_cli
  install_node_22
  prepare_user_and_directories
  configure_firewall
  configure_pm2_startup

  if [[ "${SKIP_SECRETS}" -ne 1 ]]; then
    "${SCRIPT_DIR}/load-secrets.sh" --project-id "${PROJECT_ID}"
  fi

  certbot_args=()
  if [[ "${SKIP_CERTBOT}" -eq 1 ]]; then
    certbot_args+=(--skip-certbot)
  else
    [[ -n "${CERTBOT_EMAIL}" ]] || fail "--email or CERTBOT_EMAIL is required unless --skip-certbot is used"
    certbot_args+=(--email "${CERTBOT_EMAIL}")
  fi
  "${SCRIPT_DIR}/install-nginx-and-cert.sh" "${certbot_args[@]}"
  "${SCRIPT_DIR}/deploy-nginx.sh"

  systemctl enable --now fail2ban

  printf 'Provisioned Hetzner prod host for %s with Node 22, PM2, nginx, and remote GCP services in %s\n' "${DOMAIN}" "${PROJECT_ID}"
}

main "$@"
