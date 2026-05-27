#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

DOMAIN="${DOMAIN:-intexuraos.cloud}"
ENV_FILE="${ENV_FILE:-/etc/intexuraos/.env.prod}"
PROJECT_ID="${PROJECT_ID:-intexuraos-dev-pbuchman}"
SA_KEY_FILE="${SA_KEY_FILE:-${GOOGLE_APPLICATION_CREDENTIALS:-/home/deploy/provisioner-sa-key.json}}"
CLOUDFLARE_CREDENTIALS_FILE="${CLOUDFLARE_CREDENTIALS_FILE:-/etc/letsencrypt/cloudflare.ini}"
CLOUDFLARE_DNS_API_TOKEN_SECRET="${CLOUDFLARE_DNS_API_TOKEN_SECRET:-INTEXURAOS_CLOUDFLARE_DNS_API_TOKEN}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
SKIP_CERTBOT=0
SKIP_LUAROCKS=0

usage() {
  printf 'Usage: INTEXURAOS_ENVIRONMENT=prod %s --email ops@example.com [--env-file path] [--skip-certbot] [--skip-luarocks]\n' "$(basename "$0")"
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
      --env-file)
        shift
        [[ $# -gt 0 ]] || fail "--env-file requires a value"
        ENV_FILE="$1"
        shift
        ;;
      --env-file=*)
        ENV_FILE="${1#*=}"
        shift
        ;;
      --skip-certbot)
        SKIP_CERTBOT=1
        shift
        ;;
      --skip-luarocks)
        SKIP_LUAROCKS=1
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

install_packages() {
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y \
    build-essential \
    ca-certificates \
    certbot \
    curl \
    liblua5.1-0-dev \
    lua5.1 \
    luarocks \
    nginx-extras \
    python3-certbot-dns-cloudflare
}

install_lua_dependencies() {
  if [[ "${SKIP_LUAROCKS}" -eq 1 ]]; then
    return
  fi

  luarocks --lua-version=5.1 install lua-resty-openidc
  luarocks --lua-version=5.1 install lua-resty-core
  luarocks --lua-version=5.1 install lua-resty-lrucache
  luarocks --lua-version=5.1 install lua-resty-string
}

read_env_value() {
  local key="$1"
  local value=""

  [[ -f "${ENV_FILE}" ]] || fail "Env file not found: ${ENV_FILE}. Run scripts/hetzner/load-secrets.sh first."

  value="$(node -e '
    const { readFileSync } = require("node:fs");
    const key = process.argv[1];
    const envFile = process.argv[2];
    const lines = readFileSync(envFile, "utf8").split(/\r?\n/);

    function unquote(value) {
      if (value.length >= 2 && value.startsWith("\"") && value.endsWith("\"")) {
        return value
          .slice(1, -1)
          .replace(/\\n/g, "\n")
          .replace(/\\r/g, "\r")
          .replace(/\\"/g, "\"")
          .replace(/\\\\/g, "\\");
      }
      return value;
    }

    for (const line of lines) {
      if (line === "" || line.startsWith("#")) continue;
      const index = line.indexOf("=");
      if (index === -1) continue;
      if (line.slice(0, index) === key) {
        process.stdout.write(unquote(line.slice(index + 1)));
        process.exit(0);
      }
    }
  ' "${key}" "${ENV_FILE}")"

  printf '%s' "${value}"
}

configure_gcloud_credentials() {
  local env_project_id=""
  local env_sa_key_file=""

  if [[ -f "${ENV_FILE}" ]]; then
    env_project_id="$(read_env_value "PROJECT_ID")"
    env_sa_key_file="$(read_env_value "HETZNER_PROVISIONER_GOOGLE_APPLICATION_CREDENTIALS")"
    if [[ -z "${env_sa_key_file}" ]]; then
      env_sa_key_file="$(read_env_value "GOOGLE_APPLICATION_CREDENTIALS")"
    fi
    [[ -n "${env_project_id}" ]] && PROJECT_ID="${env_project_id}"
    [[ -n "${env_sa_key_file}" ]] && SA_KEY_FILE="${env_sa_key_file}"
  fi

  if [[ -r "${SA_KEY_FILE}" ]]; then
    export CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="${SA_KEY_FILE}"
  fi
}

read_secret_value() {
  local secret_name="$1"

  gcloud secrets versions access latest \
    --secret="${secret_name}" \
    --project="${PROJECT_ID}" \
    --format='value(payload.data)' \
    | base64 --decode
}

write_cloudflare_credentials() {
  local token=""
  local temp_file=""

  command -v gcloud >/dev/null 2>&1 || fail "gcloud CLI is required"
  command -v base64 >/dev/null 2>&1 || fail "base64 is required"

  token="$(read_secret_value "${CLOUDFLARE_DNS_API_TOKEN_SECRET}")"
  [[ -n "${token}" ]] || fail "${CLOUDFLARE_DNS_API_TOKEN_SECRET} returned an empty value"

  umask 077
  temp_file="$(mktemp "${TMPDIR:-/tmp}/cloudflare.ini.XXXXXX")"
  trap 'rm -f "${temp_file}"' RETURN

  printf 'dns_cloudflare_api_token = %s\n' "${token}" > "${temp_file}"
  install -d -m 700 "$(dirname "${CLOUDFLARE_CREDENTIALS_FILE}")"
  install -m 600 "${temp_file}" "${CLOUDFLARE_CREDENTIALS_FILE}"
}

request_certificate() {
  if [[ "${SKIP_CERTBOT}" -eq 1 ]]; then
    return
  fi

  [[ -n "${CERTBOT_EMAIL}" ]] || fail "--email or CERTBOT_EMAIL is required for certbot"

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
    configure_gcloud_credentials
    write_cloudflare_credentials
    request_certificate
    install_renewal_hook
  fi

  enable_services

  printf 'Installed nginx, Lua JWT dependencies, and certificate material for %s\n' "${DOMAIN}"
}

main "$@"
