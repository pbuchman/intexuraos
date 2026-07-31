#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NGINX_SOURCE_DIR="${SCRIPT_DIR}/nginx"
SITE_TARGET="/etc/nginx/sites-available/intexuraos.conf"
SITE_ENABLED="/etc/nginx/sites-enabled/intexuraos.conf"
LUA_TARGET_DIR="/etc/nginx/lua"
NGINX_HASH_CONFIG_TARGET="/etc/nginx/conf.d/intexuraos-hash.conf"
MESSAGE_DIGEST_UPSTREAM_TARGET="/etc/nginx/intexuraos-message-digest-upstream.conf"
MESSAGE_DIGEST_PUBLIC_TARGET="/etc/nginx/intexuraos-message-digests-public.conf"
MESSAGE_DIGEST_MODE="public"
RELOAD_NGINX=1

usage() {
  printf 'Usage: INTEXURAOS_ENVIRONMENT=prod %s [--skip-reload] [--message-digests-candidate-unavailable|--message-digests-full-cutover-hold|--message-digests-public]\n' "$(basename "$0")"
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
      --skip-reload)
        RELOAD_NGINX=0
        shift
        ;;
      --message-digests-candidate-unavailable)
        MESSAGE_DIGEST_MODE="candidate-unavailable"
        shift
        ;;
      --message-digests-full-cutover-hold)
        MESSAGE_DIGEST_MODE="full-cutover-hold"
        shift
        ;;
      --message-digests-public)
        MESSAGE_DIGEST_MODE="public"
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

install_message_digest_admission_config() {
  local public_source=""
  local upstream_address=""
  local upstream_temp=""

  case "${MESSAGE_DIGEST_MODE}" in
    candidate-unavailable)
      upstream_address="127.0.0.1:18135"
      public_source="${NGINX_SOURCE_DIR}/message-digests-candidate-unavailable.conf"
      ;;
    full-cutover-hold)
      upstream_address="127.0.0.1:8135"
      public_source="${NGINX_SOURCE_DIR}/message-digests-full-cutover-hold.conf"
      ;;
    public)
      upstream_address="127.0.0.1:8135"
      public_source="${NGINX_SOURCE_DIR}/message-digests-public-active.conf"
      ;;
    *)
      fail "Unsupported Message Digest nginx admission mode"
      ;;
  esac

  [[ -r "${public_source}" ]] || fail "Missing Message Digest public ingress snippet"
  upstream_temp="$(mktemp "${TMPDIR:-/tmp}/intexuraos-message-digest-upstream.XXXXXX")"
  printf 'server %s;\n' "${upstream_address}" > "${upstream_temp}"
  install -m 644 -o root -g root "${upstream_temp}" "${MESSAGE_DIGEST_UPSTREAM_TARGET}"
  install -m 644 -o root -g root "${public_source}" "${MESSAGE_DIGEST_PUBLIC_TARGET}"
  rm -f "${upstream_temp}"
}

reload_nginx() {
  if [[ "${RELOAD_NGINX}" -ne 1 ]]; then
    return
  fi

  if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet nginx; then
    systemctl reload nginx
    return
  fi

  nginx -s reload
}

write_nginx_hash_config() {
  local temp_file=""

  install -d -m 755 "$(dirname "${NGINX_HASH_CONFIG_TARGET}")"
  temp_file="$(mktemp "${TMPDIR:-/tmp}/intexuraos-nginx-hash.XXXXXX")"
  cat > "${temp_file}" <<'EOF'
variables_hash_max_size 2048;
variables_hash_bucket_size 128;
EOF
  install -m 644 -o root -g root "${temp_file}" "${NGINX_HASH_CONFIG_TARGET}"
  rm -f "${temp_file}"
}

verify_lua_jwt_dependencies() {
  command -v lua5.1 >/dev/null 2>&1 || fail "lua5.1 is required for nginx JWT verification"
  lua5.1 <<'LUA' || fail "nginx Lua JWT dependencies are missing"
local ok, cjson = pcall(require, "cjson.safe")
if not ok or cjson == nil then
  error("missing cjson.safe")
end

local openidc_loader, openidc_error = package.loaders[2]("resty.openidc")
if type(openidc_loader) ~= "function" then
  error(openidc_error or "missing resty.openidc")
end
LUA
}

main() {
  parse_args "$@"
  require_prod
  require_root

  command -v nginx >/dev/null 2>&1 || fail "nginx is required"
  [[ -r "${NGINX_SOURCE_DIR}/intexuraos.conf" ]] || fail "Missing nginx config source"
  [[ -r "${NGINX_SOURCE_DIR}/jwt-verify.lua" ]] || fail "Missing JWT verifier source"

  install -d -m 755 "$(dirname "${SITE_TARGET}")" "$(dirname "${SITE_ENABLED}")" "${LUA_TARGET_DIR}"
  install -m 644 -o root -g root "${NGINX_SOURCE_DIR}/intexuraos.conf" "${SITE_TARGET}"
  install -m 644 -o root -g root "${NGINX_SOURCE_DIR}/jwt-verify.lua" "${LUA_TARGET_DIR}/jwt-verify.lua"
  install_message_digest_admission_config
  write_nginx_hash_config
  ln -sfn "${SITE_TARGET}" "${SITE_ENABLED}"
  rm -f /etc/nginx/sites-enabled/default

  verify_lua_jwt_dependencies
  nginx -t
  reload_nginx

  printf 'Deployed nginx config for intexuraos.cloud\n'
}

main "$@"
