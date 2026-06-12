#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

CONFIG_SOURCE="${CONFIG_SOURCE:-ecosystem.config.prod.cjs}"
RENDERED_CONFIG="${RENDERED_CONFIG:-/home/deploy/.pm2/intexuraos-prod-ecosystem.json}"
PM2_START_TIMEOUT_SECONDS="${PM2_START_TIMEOUT_SECONDS:-120}"
PM2_SYSTEMD_SERVICE="${PM2_SYSTEMD_SERVICE:-pm2-deploy.service}"
PM2_HEALTH_URLS="${PM2_HEALTH_URLS:-http://127.0.0.1:8122/health http://127.0.0.1:8110/health}"
TEMP_RENDERED_CONFIG=""

usage() {
  printf 'Usage: INTEXURAOS_ENVIRONMENT=prod %s [--config path] [--rendered-config path]\n' "$(basename "$0")"
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

cleanup_temp_file() {
  if [[ -n "${TEMP_RENDERED_CONFIG:-}" ]]; then
    rm -f "${TEMP_RENDERED_CONFIG}"
  fi
}

require_prod() {
  if [[ "${INTEXURAOS_ENVIRONMENT:-}" != "prod" ]]; then
    fail "INTEXURAOS_ENVIRONMENT must be prod"
  fi
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --config)
        shift
        [[ $# -gt 0 ]] || fail "--config requires a value"
        CONFIG_SOURCE="$1"
        shift
        ;;
      --config=*)
        CONFIG_SOURCE="${1#*=}"
        shift
        ;;
      --rendered-config)
        shift
        [[ $# -gt 0 ]] || fail "--rendered-config requires a value"
        RENDERED_CONFIG="$1"
        shift
        ;;
      --rendered-config=*)
        RENDERED_CONFIG="${1#*=}"
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

render_config() {
  local config_source="$1"
  local output_file="$2"

  node - "${config_source}" > "${output_file}" <<'NODE'
const path = require('node:path');

const configPath = path.resolve(process.cwd(), process.argv[2]);
const config = require(configPath);

if (!config || !Array.isArray(config.apps)) {
  throw new Error(`PM2 config ${configPath} must export an { apps: [] } object`);
}

process.stdout.write(JSON.stringify(config, null, 2));
NODE
}

wait_for_pm2_online() {
  local deadline=$((SECONDS + PM2_START_TIMEOUT_SECONDS))
  local not_online=""

  while ((SECONDS < deadline)); do
    not_online="$(
      pm2 jlist | node -e '
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  const apps = JSON.parse(input);
  const notOnline = apps
    .filter((app) => app.pm2_env?.status !== "online")
    .map((app) => `${app.name}:${app.pm2_env?.status ?? "unknown"}`);

  process.stdout.write(notOnline.join("\n"));
});
'
    )"

    if [[ -z "${not_online}" ]]; then
      return 0
    fi

    sleep 5
  done

  printf 'ERROR: PM2 apps failed to reach online state:\n%s\n' "${not_online}" >&2
  pm2 status >&2 || true
  return 1
}

wait_for_http_health() {
  local deadline=$((SECONDS + PM2_START_TIMEOUT_SECONDS))
  local failed_urls=""
  local health_urls=()
  local url=""
  local IFS=' '

  read -r -a health_urls <<< "${PM2_HEALTH_URLS}"

  while ((SECONDS < deadline)); do
    failed_urls=""

    for url in "${health_urls[@]}"; do
      if ! curl --fail --silent --show-error --max-time 5 "${url}" >/dev/null; then
        failed_urls="${failed_urls}${url}"$'\n'
      fi
    done

    if [[ -z "${failed_urls}" ]]; then
      return 0
    fi

    sleep 5
  done

  printf 'ERROR: HTTP health checks did not become ready:\n%s\n' "${failed_urls}" >&2
  return 1
}

sync_pm2_systemd_service() {
  command -v systemctl >/dev/null 2>&1 || return 0
  command -v sudo >/dev/null 2>&1 || fail "sudo is required to start ${PM2_SYSTEMD_SERVICE}"

  sudo -n systemctl reset-failed "${PM2_SYSTEMD_SERVICE}" || true
  sudo -n systemctl start "${PM2_SYSTEMD_SERVICE}"
  sudo -n systemctl is-active --quiet "${PM2_SYSTEMD_SERVICE}" \
    || fail "${PM2_SYSTEMD_SERVICE} did not become active after pm2 save"
}

main() {
  parse_args "$@"
  require_prod

  [[ "${PM2_START_TIMEOUT_SECONDS}" =~ ^[0-9]+$ ]] || fail "PM2_START_TIMEOUT_SECONDS must be an integer"
  command -v curl >/dev/null 2>&1 || fail "curl is required"
  command -v node >/dev/null 2>&1 || fail "node is required"
  command -v pm2 >/dev/null 2>&1 || fail "pm2 is required"
  [[ -r "${CONFIG_SOURCE}" ]] || fail "PM2 config is not readable: ${CONFIG_SOURCE}"

  umask 077
  TEMP_RENDERED_CONFIG="$(mktemp "${TMPDIR:-/tmp}/intexuraos-pm2.XXXXXX.json")"
  trap cleanup_temp_file EXIT

  render_config "${CONFIG_SOURCE}" "${TEMP_RENDERED_CONFIG}"
  install -d -m 700 "$(dirname "${RENDERED_CONFIG}")"
  install -m 600 "${TEMP_RENDERED_CONFIG}" "${RENDERED_CONFIG}"

  pm2 delete all || true
  pm2 start "${RENDERED_CONFIG}" --update-env
  wait_for_pm2_online
  wait_for_http_health
  pm2 save
  sync_pm2_systemd_service
  pm2 status
}

main "$@"
