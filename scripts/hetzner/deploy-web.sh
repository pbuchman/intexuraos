#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${REPO_DIR:-$(cd "${SCRIPT_DIR}/../.." && pwd)}"
ENV_FILE="${ENV_FILE:-/etc/intexuraos/.env.prod}"
WEB_RELEASES_ROOT="${WEB_RELEASES_ROOT:-/var/www/intexuraos/web/releases}"
WEB_CURRENT_LINK="${WEB_CURRENT_LINK:-/var/www/intexuraos/web/current}"
WEB_ROOT="${WEB_ROOT:-}"
ACTIVATE_WEB="true"
if [[ -n "${WEB_ROOT}" ]]; then
  ACTIVATE_WEB="false"
fi
WEB_BUILD_ENV_KEYS=(
  INTEXURAOS_AUTH0_DOMAIN
  INTEXURAOS_AUTH0_SPA_CLIENT_ID
  INTEXURAOS_AUTH_AUDIENCE
  INTEXURAOS_FIREBASE_PROJECT_ID
  INTEXURAOS_FIREBASE_API_KEY
  INTEXURAOS_FIREBASE_AUTH_DOMAIN
  INTEXURAOS_SENTRY_DSN_WEB
)
WEB_ENV_BACKUP_DIR=""
WEB_SANITIZED_ENV_FILE=""

usage() {
  printf 'Usage: COMMIT_SHA=<40hex> COMMIT_MESSAGE=<subject> INTEXURAOS_ENVIRONMENT=prod %s [--repo-dir path] [--env-file path] [--web-root path]\n' "$(basename "$0")"
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

require_command() {
  local command_name="$1"
  command -v "${command_name}" >/dev/null 2>&1 || fail "${command_name} is required"
}

clear_intexuraos_env() {
  local key=""

  while IFS='=' read -r key _; do
    [[ "${key}" =~ ^INTEXURAOS_[A-Z0-9_]+$ ]] || continue
    unset "${key}"
  done < <(env)
}

export_build_metadata() {
  [[ -n "${COMMIT_SHA:-}" ]] || fail "COMMIT_SHA is required"
  [[ "${COMMIT_SHA}" =~ ^[0-9a-f]{40}$ ]] \
    || fail "COMMIT_SHA must be a 40-character lowercase hexadecimal SHA"
  [[ -n "${COMMIT_MESSAGE:-}" ]] || fail "COMMIT_MESSAGE is required"

  export COMMIT_SHA
  export COMMIT_MESSAGE
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --repo-dir)
        shift
        [[ $# -gt 0 ]] || fail "--repo-dir requires a value"
        REPO_DIR="$1"
        shift
        ;;
      --repo-dir=*)
        REPO_DIR="${1#*=}"
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
      --web-root)
        shift
        [[ $# -gt 0 ]] || fail "--web-root requires a value"
        WEB_ROOT="$1"
        ACTIVATE_WEB="false"
        shift
        ;;
      --web-root=*)
        WEB_ROOT="${1#*=}"
        ACTIVATE_WEB="false"
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

read_env_value() {
  local key="$1"
  local value=""

  [[ -f "${ENV_FILE}" ]] || fail "Env file not found: ${ENV_FILE}. Run scripts/hetzner/load-secrets.sh first."

  value="$(node -e '
    const { readFileSync } = require("node:fs");
    const { parse } = require("dotenv");
    const key = process.argv[1];
    const envFile = process.argv[2];
    const parsed = parse(readFileSync(envFile, "utf8"));
    if (Object.hasOwn(parsed, key)) {
      process.stdout.write(parsed[key]);
    }
  ' "${key}" "${ENV_FILE}")"

  printf '%s' "${value}"
}

dotenv_escape() {
  local value="$1"

  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  printf '"%s"' "${value}"
}

write_env_line() {
  local output_path="$1"
  local key="$2"
  local value="$3"

  printf '%s=%s\n' "${key}" "$(dotenv_escape "${value}")" >> "${output_path}"
}

export_web_service_urls() {
  local manifest_path="${REPO_DIR}/apps/web/service-manifest.json"
  local rendered_service_entries=""
  local env_var=""
  local api_path=""

  [[ -f "${manifest_path}" ]] || fail "Missing web service manifest: ${manifest_path}"
  rendered_service_entries="$(
    node "${REPO_DIR}/scripts/render-production-web-service-env.mjs" "${manifest_path}"
  )" || fail "Failed to render production web service URLs"

  while IFS=$'\t' read -r env_var api_path; do
    [[ -n "${env_var}" && -n "${api_path}" ]] || continue
    export "${env_var}=${api_path}"
  done <<< "${rendered_service_entries}"
}

prepare_sanitized_web_env_file() {
  local web_dir="${REPO_DIR}/apps/web"
  local env_name=""
  local env_path=""
  local key=""
  local env_value=""
  local rendered_service_entries=""
  local service_env_var=""
  local service_api_path=""

  [[ -d "${web_dir}" ]] || fail "Missing web app directory: ${web_dir}"

  WEB_ENV_BACKUP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/intexuraos-web-env.XXXXXX")"
  for env_name in .env .env.local .env.production .env.production.local; do
    env_path="${web_dir}/${env_name}"
    if [[ -e "${env_path}" || -L "${env_path}" ]]; then
      mv "${env_path}" "${WEB_ENV_BACKUP_DIR}/${env_name}"
    fi
  done

  WEB_SANITIZED_ENV_FILE="${web_dir}/.env.production.local"
  : > "${WEB_SANITIZED_ENV_FILE}"
  chmod 600 "${WEB_SANITIZED_ENV_FILE}"
  write_env_line "${WEB_SANITIZED_ENV_FILE}" "INTEXURAOS_ENVIRONMENT" "prod"

  for key in "${WEB_BUILD_ENV_KEYS[@]}"; do
    env_value="$(read_env_value "${key}")"
    [[ -n "${env_value}" ]] || fail "${key} is missing from ${ENV_FILE}"
    write_env_line "${WEB_SANITIZED_ENV_FILE}" "${key}" "${env_value}"
  done

  rendered_service_entries="$(
    node "${REPO_DIR}/scripts/render-production-web-service-env.mjs" \
      "${REPO_DIR}/apps/web/service-manifest.json"
  )" || fail "Failed to render sanitized production web service URLs"
  while IFS=$'\t' read -r service_env_var service_api_path; do
    [[ -n "${service_env_var}" && -n "${service_api_path}" ]] || continue
    write_env_line "${WEB_SANITIZED_ENV_FILE}" "${service_env_var}" "${service_api_path}"
  done <<< "${rendered_service_entries}"
}

restore_web_env_files() {
  local web_dir="${REPO_DIR}/apps/web"
  local backup_path=""
  local env_name=""

  if [[ -n "${WEB_SANITIZED_ENV_FILE}" ]]; then
    rm -f "${WEB_SANITIZED_ENV_FILE}"
  fi

  if [[ -n "${WEB_ENV_BACKUP_DIR}" && -d "${WEB_ENV_BACKUP_DIR}" ]]; then
    for backup_path in "${WEB_ENV_BACKUP_DIR}"/.env*; do
      [[ -e "${backup_path}" || -L "${backup_path}" ]] || continue
      env_name="$(basename "${backup_path}")"
      mv "${backup_path}" "${web_dir}/${env_name}"
    done
    rmdir "${WEB_ENV_BACKUP_DIR}" 2>/dev/null || true
  fi
}

build_web() {
  cd "${REPO_DIR}"
  prepare_sanitized_web_env_file
  pnpm --filter @intexuraos/web build

  [[ -f apps/web/dist/index.html ]] || fail "apps/web/dist/index.html was not produced"
}

publish_inactive_web_root() {
  [[ -n "${WEB_ROOT}" ]] || fail "WEB_ROOT is required for a non-activating Web build"
  WEB_ROOT="${WEB_ROOT%/}"
  install -d -m 755 "${WEB_ROOT}"
  rsync -a --delete apps/web/dist/ "${WEB_ROOT}/"
}

stage_web_release() {
  local staging_dir=""
  local differences=""
  WEB_ROOT="${WEB_RELEASES_ROOT%/}/${COMMIT_SHA}"
  install -d -m 755 "${WEB_RELEASES_ROOT}"
  if [[ -e "${WEB_ROOT}" || -L "${WEB_ROOT}" ]]; then
    [[ -d "${WEB_ROOT}" && ! -L "${WEB_ROOT}" && -f "${WEB_ROOT}/index.html" ]] \
      || fail "Existing Web release target is invalid"
    differences="$(rsync -rcln --delete --itemize-changes --exclude deployment.json \
      apps/web/dist/ "${WEB_ROOT}/")"
    [[ -z "${differences}" ]] || fail "Existing Web release differs from the verified build"
    return 0
  fi
  staging_dir="$(mktemp -d "${WEB_RELEASES_ROOT}/.${COMMIT_SHA}.XXXXXX")"
  rsync -a --delete apps/web/dist/ "${staging_dir}/"
  [[ -f "${staging_dir}/index.html" ]] || fail "Staged Web release is incomplete"
  chmod 755 "${staging_dir}"
  mv -T "${staging_dir}" "${WEB_ROOT}"
}

activate_web_release() {
  local next_link=""
  [[ -d "${WEB_ROOT}" && ! -L "${WEB_ROOT}" && -f "${WEB_ROOT}/index.html" ]] \
    || fail "Web release is not ready for activation"
  install -d -m 755 "$(dirname "${WEB_CURRENT_LINK}")"
  next_link="$(mktemp "${WEB_CURRENT_LINK}.next.XXXXXX")"
  rm -f -- "${next_link}"
  ln -s "${WEB_ROOT}" "${next_link}"
  mv -Tf "${next_link}" "${WEB_CURRENT_LINK}"
}

build_and_publish() {
  build_web
  if [[ "${ACTIVATE_WEB}" == "false" ]]; then
    publish_inactive_web_root
    return 0
  fi
  stage_web_release
  activate_web_release
}

main() {
  parse_args "$@"
  require_prod
  require_command node
  require_command pnpm
  require_command rsync
  trap restore_web_env_files EXIT
  clear_intexuraos_env
  export_build_metadata
  export INTEXURAOS_ENVIRONMENT=prod
  export_web_service_urls
  build_and_publish

  printf 'Published web SPA from %s/apps/web/dist to %s\n' "${REPO_DIR}" "${WEB_ROOT%/}"
}

main "$@"
