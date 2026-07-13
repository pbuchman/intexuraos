#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

DEPLOY_USER="${DEPLOY_USER:-deploy}"
PM2_HOME="${PM2_HOME:-/home/${DEPLOY_USER}/.pm2}"
PM2_BIN="${PM2_BIN:-}"
RUNUSER_BIN="${RUNUSER_BIN:-/usr/sbin/runuser}"
LOGROTATE_CONFIG_PATH="${LOGROTATE_CONFIG_PATH:-/etc/logrotate.d/intexuraos-pm2}"
MODE="install"
TEMP_CONFIG=""

usage() {
  printf 'Usage: INTEXURAOS_ENVIRONMENT=prod %s [--render]\n' "$(basename "$0")"
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

cleanup() {
  if [[ -n "${TEMP_CONFIG:-}" ]]; then
    rm -f "${TEMP_CONFIG}"
  fi
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --render)
        MODE="render"
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

resolve_pm2_bin() {
  if [[ -z "${PM2_BIN}" ]]; then
    PM2_BIN="$(command -v pm2 || true)"
  fi
  [[ -n "${PM2_BIN}" ]] || fail "pm2 is required"
  [[ "${PM2_BIN}" == /* ]] || fail "PM2_BIN must be an absolute path"
}

validate_inputs() {
  [[ "${DEPLOY_USER}" =~ ^[a-z_][a-z0-9_-]*$ ]] || fail "DEPLOY_USER is invalid"
  [[ "${PM2_HOME}" == /* ]] || fail "PM2_HOME must be an absolute path"
  [[ "${RUNUSER_BIN}" == /* ]] || fail "RUNUSER_BIN must be an absolute path"
  [[ "${LOGROTATE_CONFIG_PATH}" == /* ]] || fail "LOGROTATE_CONFIG_PATH must be an absolute path"
}

render_policy() {
  printf '%s\n' \
    "${PM2_HOME}/logs/*.log {" \
    '  daily' \
    '  maxsize 100M' \
    '  rotate 14' \
    '  compress' \
    '  delaycompress' \
    '  missingok' \
    '  notifempty' \
    "  su ${DEPLOY_USER} ${DEPLOY_USER}" \
    "  create 0640 ${DEPLOY_USER} ${DEPLOY_USER}" \
    '  sharedscripts' \
    '  postrotate' \
    "    ${RUNUSER_BIN} -u ${DEPLOY_USER} -- env PM2_HOME=${PM2_HOME} ${PM2_BIN} reloadLogs >/dev/null 2>&1" \
    '  endscript' \
    '}'
}

install_policy() {
  command -v install >/dev/null 2>&1 || fail "install is required"
  command -v logrotate >/dev/null 2>&1 || fail "logrotate is required"
  command -v mktemp >/dev/null 2>&1 || fail "mktemp is required"
  [[ -x "${PM2_BIN}" ]] || fail "PM2_BIN is not executable: ${PM2_BIN}"
  [[ -x "${RUNUSER_BIN}" ]] || fail "RUNUSER_BIN is not executable: ${RUNUSER_BIN}"

  umask 077
  TEMP_CONFIG="$(mktemp "${TMPDIR:-/tmp}/intexuraos-pm2-logrotate.XXXXXX")"
  trap cleanup EXIT
  render_policy > "${TEMP_CONFIG}"

  logrotate --debug "${TEMP_CONFIG}" >/dev/null
  install -d -o root -g root -m 0755 "$(dirname "${LOGROTATE_CONFIG_PATH}")"
  install -o root -g root -m 0644 "${TEMP_CONFIG}" "${LOGROTATE_CONFIG_PATH}"
  printf 'Installed PM2 logrotate policy at %s\n' "${LOGROTATE_CONFIG_PATH}"
}

main() {
  parse_args "$@"
  require_prod
  resolve_pm2_bin
  validate_inputs

  if [[ "${MODE}" == "render" ]]; then
    render_policy
    return
  fi

  require_root
  install_policy
}

main "$@"
