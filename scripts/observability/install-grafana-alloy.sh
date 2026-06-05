#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

ENVIRONMENT="${INTEXURAOS_ENVIRONMENT:-}"
HOST_NAME="${INTEXURAOS_ALLOY_HOST:-}"
PM2_LOG_GLOB="${INTEXURAOS_PM2_LOG_GLOB:-}"
ENV_FILE="${INTEXURAOS_ALLOY_ENV_FILE:-}"
CONFIG_FILE="${INTEXURAOS_ALLOY_CONFIG_FILE:-/etc/alloy/config.alloy}"
SKIP_PACKAGE_INSTALL="${SKIP_PACKAGE_INSTALL:-0}"

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

require_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    fail "Run this script as root"
  fi
}

usage() {
  cat <<EOF
Usage:
  INTEXURAOS_ENVIRONMENT=dev|prod $0 [--host HOST] [--pm2-log-glob /path/*.log] [--env-file path]

Defaults:
  dev:  host=home-dev,     glob=/home/pbuchman/.pm2/logs/*.log, env=/etc/intexuraos/grafana-cloud.env
  prod: host=\$(hostname -s), glob=/home/deploy/.pm2/logs/*.log, env=/etc/intexuraos/.env.prod
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --host)
        shift
        [[ $# -gt 0 ]] || fail "--host requires a value"
        HOST_NAME="$1"
        shift
        ;;
      --host=*)
        HOST_NAME="${1#*=}"
        shift
        ;;
      --pm2-log-glob)
        shift
        [[ $# -gt 0 ]] || fail "--pm2-log-glob requires a value"
        PM2_LOG_GLOB="$1"
        shift
        ;;
      --pm2-log-glob=*)
        PM2_LOG_GLOB="${1#*=}"
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

resolve_defaults() {
  case "${ENVIRONMENT}" in
    dev)
      HOST_NAME="${HOST_NAME:-home-dev}"
      PM2_LOG_GLOB="${PM2_LOG_GLOB:-/home/pbuchman/.pm2/logs/*.log}"
      ENV_FILE="${ENV_FILE:-/etc/intexuraos/grafana-cloud.env}"
      ;;
    prod)
      HOST_NAME="${HOST_NAME:-$(hostname -s)}"
      PM2_LOG_GLOB="${PM2_LOG_GLOB:-/home/deploy/.pm2/logs/*.log}"
      ENV_FILE="${ENV_FILE:-/etc/intexuraos/.env.prod}"
      ;;
    *)
      fail "INTEXURAOS_ENVIRONMENT must be dev or prod"
      ;;
  esac
}

install_alloy_package() {
  if command -v alloy >/dev/null 2>&1; then
    return
  fi

  if [[ "${SKIP_PACKAGE_INSTALL}" == "1" ]]; then
    fail "alloy is not installed and SKIP_PACKAGE_INSTALL=1"
  fi

  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl gnupg
  install -d -m 755 /etc/apt/keyrings
  curl -fsSL https://apt.grafana.com/gpg-full.key \
    | gpg --dearmor -o /etc/apt/keyrings/grafana.gpg
  printf 'deb [signed-by=/etc/apt/keyrings/grafana.gpg] https://apt.grafana.com stable main\n' \
    > /etc/apt/sources.list.d/grafana.list
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y alloy
}

ensure_acl_package() {
  if command -v setfacl >/dev/null 2>&1; then
    return
  fi

  if [[ "${SKIP_PACKAGE_INSTALL}" == "1" ]]; then
    fail "setfacl is not installed and SKIP_PACKAGE_INSTALL=1"
  fi

  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y acl
}

configure_pm2_log_acl() {
  local log_dir=""
  local pm2_dir=""
  local home_dir=""
  local home_owner=""
  local home_group=""
  local log_file=""

  log_dir="${PM2_LOG_GLOB%/*}"
  pm2_dir="${log_dir%/*}"
  home_dir="${pm2_dir%/*}"

  [[ -d "${home_dir}" ]] || fail "PM2 home directory parent does not exist: ${home_dir}"
  id -u alloy >/dev/null 2>&1 || fail "alloy user is required before configuring PM2 log ACLs"

  home_owner="$(stat -c '%U' "${home_dir}")"
  home_group="$(stat -c '%G' "${home_dir}")"

  if [[ ! -d "${pm2_dir}" ]]; then
    install -d -o "${home_owner}" -g "${home_group}" -m 700 "${pm2_dir}"
  fi
  if [[ ! -d "${log_dir}" ]]; then
    install -d -o "${home_owner}" -g "${home_group}" -m 700 "${log_dir}"
  fi

  setfacl -m u:alloy:--x "${home_dir}"
  setfacl -m u:alloy:--x "${pm2_dir}"
  setfacl -m u:alloy:r-x "${log_dir}"
  setfacl -d -m u:alloy:r-- "${log_dir}"

  shopt -s nullglob
  for log_file in "${log_dir}"/*.log; do
    setfacl -m u:alloy:r-- "${log_file}"
  done
  shopt -u nullglob
}

write_systemd_dropin() {
  install -d -m 755 /etc/systemd/system/alloy.service.d
  cat > /etc/systemd/system/alloy.service.d/intexuraos.conf <<EOF
[Service]
EnvironmentFile=${ENV_FILE}
EOF
}

render_config() {
  [[ -f "${ENV_FILE}" ]] || fail "Missing Alloy environment file: ${ENV_FILE}"
  install -d -m 755 "$(dirname "${CONFIG_FILE}")"
  node "${REPO_ROOT}/scripts/observability/render-alloy-config.mjs" \
    --environment "${ENVIRONMENT}" \
    --host "${HOST_NAME}" \
    --pm2-log-glob "${PM2_LOG_GLOB}" \
    --output "${CONFIG_FILE}"
}

restart_alloy() {
  systemctl daemon-reload
  systemctl enable alloy.service
  systemctl restart alloy.service
  systemctl is-active --quiet alloy.service
}

main() {
  require_root
  parse_args "$@"
  resolve_defaults
  install_alloy_package
  ensure_acl_package
  configure_pm2_log_acl
  write_systemd_dropin
  render_config
  restart_alloy

  printf 'Grafana Alloy is active for %s PM2 logs on %s\n' "${ENVIRONMENT}" "${HOST_NAME}"
}

main "$@"
