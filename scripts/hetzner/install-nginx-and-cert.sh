#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
DOMAIN="${DOMAIN:-intexuraos.cloud}"
CLOUDFLARE_CREDENTIALS_FILE="${CLOUDFLARE_CREDENTIALS_FILE:-/etc/letsencrypt/cloudflare.ini}"
CUSTOM_TLS_FULLCHAIN_FILE="${CUSTOM_TLS_FULLCHAIN_FILE:-${REPO_ROOT}/terraform/certs/intexuraos.cloud/fullchain.pem}"
TLS_PRIVATE_KEY_FILE="${TLS_PRIVATE_KEY_FILE:-/etc/intexuraos/tls-private-key.pem}"
LETSENCRYPT_LIVE_DIR="${LETSENCRYPT_LIVE_DIR:-/etc/letsencrypt/live/${DOMAIN}}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
SKIP_CERTBOT=0
SKIP_LUAROCKS=0

usage() {
  printf 'Usage: INTEXURAOS_ENVIRONMENT=prod %s --email ops@example.com [--skip-certbot] [--skip-luarocks]\n' "$(basename "$0")"
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

require_prod() {
  [[ "${INTEXURAOS_ENVIRONMENT:-}" == 'prod' ]] \
    || fail 'INTEXURAOS_ENVIRONMENT must be prod'
}

require_root() {
  [[ "$(id -u)" -eq 0 ]] || fail 'Run this script as root'
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --email)
        shift
        [[ $# -gt 0 ]] || fail '--email requires a value'
        CERTBOT_EMAIL="$1"
        shift
        ;;
      --email=*) CERTBOT_EMAIL="${1#*=}"; shift ;;
      --skip-certbot) SKIP_CERTBOT=1; shift ;;
      --skip-luarocks) SKIP_LUAROCKS=1; shift ;;
      -h|--help) usage; exit 0 ;;
      *) fail "Unknown argument: $1" ;;
    esac
  done
}

install_packages() {
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y \
    build-essential \
    ca-certificates \
    certbot \
    curl \
    liblua5.1-0-dev \
    libnginx-mod-http-lua \
    lua5.1 \
    lua-cjson \
    luarocks \
    nginx-extras \
    python3-certbot-dns-cloudflare
}

install_lua_dependencies() {
  [[ "${SKIP_LUAROCKS}" -eq 1 ]] && return
  luarocks --lua-version=5.1 install lua-resty-openidc
  luarocks --lua-version=5.1 install lua-resty-core
  luarocks --lua-version=5.1 install lua-resty-lrucache
  luarocks --lua-version=5.1 install lua-resty-string
}

validate_cloudflare_credentials() {
  [[ -r "${CLOUDFLARE_CREDENTIALS_FILE}" ]] \
    || fail 'Rendered Cloudflare credentials are unavailable; run load-secrets.sh first'
  node --input-type=module - "${CLOUDFLARE_CREDENTIALS_FILE}" <<'NODE' \
    || fail 'Rendered Cloudflare credentials are invalid or not mode 600'
import { readFileSync, statSync } from 'node:fs';
const [path] = process.argv.slice(2);
const status = statSync(path);
const contents = readFileSync(path, 'utf8');
if (
  !status.isFile() ||
  (status.mode & 0o777) !== 0o600 ||
  !/^dns_cloudflare_api_token = [^\r\n\0]+\n$/u.test(contents)
) process.exit(1);
NODE
}

validate_tls_private_key() {
  [[ -r "${TLS_PRIVATE_KEY_FILE}" ]] \
    || fail "Rendered TLS private key is not readable: ${TLS_PRIVATE_KEY_FILE}"
  node --input-type=module - "${TLS_PRIVATE_KEY_FILE}" <<'NODE' \
    || fail 'Rendered TLS private key is invalid or not mode 600'
import { createPrivateKey } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
const [path] = process.argv.slice(2);
const status = statSync(path);
if (!status.isFile() || (status.mode & 0o777) !== 0o600) process.exit(1);
try { createPrivateKey(readFileSync(path, 'utf8')); } catch { process.exit(1); }
NODE
}

install_existing_certificate() {
  if [[ -r "${LETSENCRYPT_LIVE_DIR}/fullchain.pem" && -r "${LETSENCRYPT_LIVE_DIR}/privkey.pem" ]]; then
    return
  fi
  [[ -r "${CUSTOM_TLS_FULLCHAIN_FILE}" ]] \
    || fail "Existing TLS fullchain is not readable: ${CUSTOM_TLS_FULLCHAIN_FILE}"
  validate_tls_private_key
  install -d -m 755 "${LETSENCRYPT_LIVE_DIR}"
  install -m 644 "${CUSTOM_TLS_FULLCHAIN_FILE}" "${LETSENCRYPT_LIVE_DIR}/fullchain.pem"
  install -m 600 "${TLS_PRIVATE_KEY_FILE}" "${LETSENCRYPT_LIVE_DIR}/privkey.pem"
}

request_certificate() {
  [[ -n "${CERTBOT_EMAIL}" ]] || fail '--email or CERTBOT_EMAIL is required for certbot'
  certbot certonly \
    --dns-cloudflare \
    --dns-cloudflare-credentials "${CLOUDFLARE_CREDENTIALS_FILE}" \
    --dns-cloudflare-propagation-seconds 60 \
    --domain "${DOMAIN}" \
    --agree-tos \
    --email "${CERTBOT_EMAIL}" \
    --keep-until-expiring \
    --non-interactive
}

install_renewal_hook() {
  install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
  cat > /etc/letsencrypt/renewal-hooks/deploy/intexuraos-nginx-reload.sh <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail
systemctl reload nginx
HOOK
  chmod 755 /etc/letsencrypt/renewal-hooks/deploy/intexuraos-nginx-reload.sh
}

enable_services() {
  systemctl enable --now nginx
  systemctl enable --now certbot.timer || true
}

main() {
  parse_args "$@"
  require_prod
  require_root
  install_packages
  install_lua_dependencies
  if [[ "${SKIP_CERTBOT}" -ne 1 ]]; then
    validate_cloudflare_credentials
    request_certificate
    install_renewal_hook
  else
    install_existing_certificate
  fi
  enable_services
  printf 'Installed nginx, Lua JWT dependencies, and rendered certificate material for %s\n' "${DOMAIN}"
}

main "$@"
