#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${REPO_DIR:-$(cd "${SCRIPT_DIR}/../.." && pwd)}"
ENV_FILE="${ENV_FILE:-/etc/intexuraos/.env.prod}"
WEB_ROOT="${WEB_ROOT:-/var/www/intexuraos/web/dist}"
WEB_SAFE_SECRETS=(
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
  printf 'Usage: INTEXURAOS_ENVIRONMENT=prod %s [--repo-dir path] [--env-file path] [--web-root path]\n' "$(basename "$0")"
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
        shift
        ;;
      --web-root=*)
        WEB_ROOT="${1#*=}"
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

export_web_safe_secrets() {
  local key=""
  local value=""

  for key in "${WEB_SAFE_SECRETS[@]}"; do
    value="$(read_env_value "${key}")"
    [[ -n "${value}" ]] || fail "${key} is missing from ${ENV_FILE}"
    export "${key}=${value}"
  done

  export INTEXURAOS_ENVIRONMENT=prod
}

export_web_service_urls() {
  local manifest_path="${REPO_DIR}/apps/web/service-manifest.json"
  local env_var=""
  local api_path=""

  [[ -f "${manifest_path}" ]] || fail "Missing web service manifest: ${manifest_path}"

  while IFS=$'\t' read -r env_var api_path; do
    [[ -n "${env_var}" && -n "${api_path}" ]] || continue
    export "${env_var}=${api_path}"
  done < <(
    node -e '
      const { readFileSync } = require("node:fs");
      const manifest = JSON.parse(readFileSync(process.argv[1], "utf8"));
      for (const service of manifest.services) {
        process.stdout.write("INTEXURAOS_" + service.envSuffix + "_URL\t" + service.apiPath + "\n");
      }
    ' "${manifest_path}"
  )
}

prepare_sanitized_web_env_file() {
  local web_dir="${REPO_DIR}/apps/web"
  local env_name=""
  local env_path=""
  local key=""
  local env_value=""

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

  for key in "${WEB_SAFE_SECRETS[@]}"; do
    env_value="${!key}"
    write_env_line "${WEB_SANITIZED_ENV_FILE}" "${key}" "${env_value}"
  done

  node -e '
    const { readFileSync, appendFileSync } = require("node:fs");
    const manifest = JSON.parse(readFileSync(process.argv[1], "utf8"));
    const outputPath = process.argv[2];
    const quote = (value) => "\"" + String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + "\"";
    for (const service of manifest.services) {
      appendFileSync(outputPath, "INTEXURAOS_" + service.envSuffix + "_URL=" + quote(service.apiPath) + "\n");
    }
  ' "${REPO_DIR}/apps/web/service-manifest.json" "${WEB_SANITIZED_ENV_FILE}"
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

build_and_publish() {
  WEB_ROOT="${WEB_ROOT%/}"

  cd "${REPO_DIR}"
  prepare_sanitized_web_env_file
  pnpm --filter @intexuraos/web build

  [[ -f apps/web/dist/index.html ]] || fail "apps/web/dist/index.html was not produced"
  install -d -m 755 "${WEB_ROOT}"
  rsync -a --delete apps/web/dist/ "${WEB_ROOT}/"
}

main() {
  parse_args "$@"
  require_prod
  require_command node
  require_command pnpm
  require_command rsync
  trap restore_web_env_files EXIT
  clear_intexuraos_env
  export_web_safe_secrets
  export_web_service_urls
  build_and_publish

  printf 'Published web SPA from %s/apps/web/dist to %s\n' "${REPO_DIR}" "${WEB_ROOT%/}"
}

main "$@"
