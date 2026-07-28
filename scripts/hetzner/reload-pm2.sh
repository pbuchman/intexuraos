#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

CONFIG_SOURCE="${CONFIG_SOURCE:-ecosystem.config.prod.cjs}"
RENDERED_CONFIG="${RENDERED_CONFIG:-/home/deploy/.pm2/intexuraos-prod-ecosystem.json}"
PM2_START_TIMEOUT_SECONDS="${PM2_START_TIMEOUT_SECONDS:-120}"
PM2_SYSTEMD_SERVICE="${PM2_SYSTEMD_SERVICE:-pm2-deploy.service}"
PM2_HEALTH_URLS="${PM2_HEALTH_URLS:-}"
PM2_HEALTH_CONSECUTIVE_SUCCESSES="${PM2_HEALTH_CONSECUTIVE_SUCCESSES:-3}"
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
  if [[ ! "${INTEXURAOS_COMMIT_SHA:-}" =~ ^[0-9a-f]{40}$ ]]; then
    fail "INTEXURAOS_COMMIT_SHA must be a 40-character lowercase hexadecimal SHA"
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

derive_health_urls() {
  node - "${RENDERED_CONFIG}" <<'NODE'
const { readFileSync } = require('node:fs');

const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (!config || !Array.isArray(config.apps)) {
  throw new Error('Rendered PM2 config must contain apps');
}

const urls = config.apps.map((app) => {
  const port = Number(app.env?.PORT);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`PM2 app ${app.name ?? 'unknown'} has invalid PORT`);
  }
  return `http://127.0.0.1:${port}/health`;
});

if (urls.length === 0) {
  throw new Error('Rendered PM2 config must contain at least one app');
}
if (new Set(urls).size !== urls.length) {
  throw new Error('Rendered PM2 config contains duplicate health ports');
}

process.stdout.write(urls.join(' '));
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
  local healthy_passes=0
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
      healthy_passes=$((healthy_passes + 1))
      if ((healthy_passes >= PM2_HEALTH_CONSECUTIVE_SUCCESSES)); then
        return 0
      fi
    else
      healthy_passes=0
    fi

    sleep 5
  done

  printf 'ERROR: PM2 health checks did not remain ready:\n%s\n' "${failed_urls}" >&2
  pm2 status >&2 || true
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
  [[ "${PM2_HEALTH_CONSECUTIVE_SUCCESSES}" =~ ^[1-9][0-9]*$ ]] \
    || fail "PM2_HEALTH_CONSECUTIVE_SUCCESSES must be a positive integer"
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
  if [[ -z "${PM2_HEALTH_URLS}" ]]; then
    PM2_HEALTH_URLS="$(derive_health_urls)"
  fi

  pm2 delete all || true
  pm2 start "${RENDERED_CONFIG}" --update-env
  wait_for_pm2_online
  wait_for_http_health
  pm2 save
  sync_pm2_systemd_service
  pm2 status
}

main "$@"
