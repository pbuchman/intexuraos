#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

DEPLOY_USER="${DEPLOY_USER:-intexuraos-prod}"
DEPLOY_HOME="${DEPLOY_HOME:-/home/intexuraos-prod}"
REPO_DIR="${REPO_DIR:-${DEPLOY_HOME}/deploy/intexuraos}"
CODE_RELEASES_ROOT="${CODE_RELEASES_ROOT:-${DEPLOY_HOME}/deploy/releases}"
CODE_CURRENT_LINK="${CODE_CURRENT_LINK:-${DEPLOY_HOME}/deploy/current}"
WEB_RELEASES_ROOT="${WEB_RELEASES_ROOT:-/var/www/intexuraos-prod/web/releases}"
WEB_CURRENT_LINK="${WEB_CURRENT_LINK:-/var/www/intexuraos-prod/web/current}"
PROD_CONFIG_ROOT="${PROD_CONFIG_ROOT:-${DEPLOY_HOME}/.config/intexuraos/prod}"
PROD_ENV_FILE="${PROD_ENV_FILE:-${PROD_CONFIG_ROOT}/.env.prod}"
EXPECTED_PM2_HOME="${DEPLOY_HOME}/.pm2-intexuraos-prod"
DEPLOY_LOCK_FILE="${DEPLOY_LOCK_FILE:-${DEPLOY_HOME}/.local/state/intexuraos-prod/deploy.lock}"
SECRET_PACKAGE_VERSION=""
TARGET_SHA=""
SECRET_PACKAGE_PAYLOAD_FILE=""
STAGING_RELEASE=""
TEMP_RELEASE=""
CANDIDATE_OUTPUT=""
CANDIDATE_WORK_DIR=""
PRIVATE_PAYLOAD=""
TEMP_WEB_RELEASE=""
WEB_RELEASE_EXISTS="0"
LOCK_FD=""
ACTIVATION_STARTED="0"
ACTIVATION_SUCCEEDED="0"
PREVIOUS_CODE_LINK_EXISTS="0"
PREVIOUS_CODE_TARGET=""
PREVIOUS_WEB_LINK_EXISTS="0"
PREVIOUS_WEB_TARGET=""

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

cleanup() {
  local status=$?
  trap - EXIT
  set +e
  if [[ "${status}" -ne 0 && "${ACTIVATION_STARTED}" == "1" \
    && "${ACTIVATION_SUCCEEDED}" != "1" ]]; then
    rm -f -- "${EXPECTED_PM2_HOME}/dump.pm2" "${EXPECTED_PM2_HOME}/dump.pm2.bak"
    restore_current_link "${CODE_CURRENT_LINK}" \
      "${PREVIOUS_CODE_LINK_EXISTS}" "${PREVIOUS_CODE_TARGET}"
    restore_current_link "${WEB_CURRENT_LINK}" \
      "${PREVIOUS_WEB_LINK_EXISTS}" "${PREVIOUS_WEB_TARGET}"
  fi
  if [[ -n "${TEMP_RELEASE}" && -d "${TEMP_RELEASE}" ]]; then
    rm -rf -- "${TEMP_RELEASE}"
  fi
  if [[ -n "${CANDIDATE_WORK_DIR}" && -d "${CANDIDATE_WORK_DIR}" ]]; then
    rm -rf -- "${CANDIDATE_WORK_DIR}"
  fi
  if [[ -n "${TEMP_WEB_RELEASE}" && -d "${TEMP_WEB_RELEASE}" ]]; then
    rm -rf -- "${TEMP_WEB_RELEASE}"
  fi
  exit "${status}"
}
trap cleanup EXIT

restore_current_link() {
  local link_path="$1"
  local existed="$2"
  local target="$3"
  local next_link=""
  if [[ "${existed}" == "1" ]]; then
    next_link="$(mktemp "${link_path}.rollback.XXXXXX")"
    rm -f -- "${next_link}"
    ln -s "${target}" "${next_link}"
    mv -Tf "${next_link}" "${link_path}"
  else
    rm -f -- "${link_path}"
  fi
}

parse_args() {
  [[ $# -eq 3 ]] || fail 'Usage: deploy-release.sh <40hex-sha> <positive-secret-version> <root-owned-candidate>'
  TARGET_SHA="$1"
  SECRET_PACKAGE_VERSION="$2"
  SECRET_PACKAGE_PAYLOAD_FILE="$3"
  [[ "${TARGET_SHA}" =~ ^[0-9a-f]{40}$ ]] \
    || fail 'Release SHA must be exactly 40 lowercase hexadecimal characters'
  [[ "${SECRET_PACKAGE_VERSION}" =~ ^[1-9][0-9]*$ ]] \
    || fail 'Secret package version must be an exact positive integer'
}

require_preconditions() {
  local deploy_uid=""
  deploy_uid="$(id -u "${DEPLOY_USER}")" || fail "Deployment user ${DEPLOY_USER} does not exist"
  [[ "${EUID}" -eq "${deploy_uid}" ]] || fail "Deployment must run as ${DEPLOY_USER}"
  [[ "${HOME}" == "${DEPLOY_HOME}" ]] || fail "HOME must be ${DEPLOY_HOME}"
  [[ "${PM2_HOME:-}" == "${EXPECTED_PM2_HOME}" ]] \
    || fail "PM2_HOME must be ${EXPECTED_PM2_HOME}"
  [[ -d "${REPO_DIR}/.git" && ! -L "${REPO_DIR}" ]] || fail 'Dedicated deployment clone is missing or unsafe'
  [[ -f "${SECRET_PACKAGE_PAYLOAD_FILE}" && ! -L "${SECRET_PACKAGE_PAYLOAD_FILE}" ]] \
    || fail 'Secret package candidate is missing or is a symlink'
  [[ -r "${SECRET_PACKAGE_PAYLOAD_FILE}" && ! -w "${SECRET_PACKAGE_PAYLOAD_FILE}" ]] \
    || fail 'Secret package candidate must be readable and non-writable'
  for command_name in flock git install node pm2 pnpm rsync tar; do
    command -v "${command_name}" >/dev/null 2>&1 || fail "${command_name} is required"
  done
  [[ -z "$(git -C "${REPO_DIR}" status --porcelain=v1 --untracked-files=all)" ]] \
    || fail 'Deployment clone is not clean'
}

acquire_lock() {
  install -d -m 700 "$(dirname "${DEPLOY_LOCK_FILE}")"
  : > "${DEPLOY_LOCK_FILE}"
  chmod 600 "${DEPLOY_LOCK_FILE}"
  exec {LOCK_FD}<>"${DEPLOY_LOCK_FILE}"
  flock --exclusive --wait 30 "${LOCK_FD}" || fail 'Timed out waiting for the Home PROD deployment lock'
}

resolve_release() {
  git -C "${REPO_DIR}" fetch --quiet --no-tags origin development
  git -C "${REPO_DIR}" cat-file -e "${TARGET_SHA}^{commit}" 2>/dev/null \
    || fail 'Release SHA is not available in the dedicated clone'
  git -C "${REPO_DIR}" merge-base --is-ancestor "${TARGET_SHA}" origin/development \
    || fail 'Release SHA is not an ancestor of origin/development'
  [[ "$(git -C "${REPO_DIR}" rev-parse "${TARGET_SHA}^{commit}")" == "${TARGET_SHA}" ]] \
    || fail 'Release SHA did not resolve exactly'
}

prepare_release_tree() {
  install -d -m 700 "${CODE_RELEASES_ROOT}"
  STAGING_RELEASE="$(mktemp -d "${CODE_RELEASES_ROOT}/${TARGET_SHA}.XXXXXX")"
  TEMP_RELEASE="${STAGING_RELEASE}"
  git -C "${REPO_DIR}" archive --format=tar "${TARGET_SHA}" | tar -xf - -C "${STAGING_RELEASE}"
  printf '%s\n' "${TARGET_SHA}" > "${STAGING_RELEASE}/.intexuraos-release-sha"
  chmod 600 "${STAGING_RELEASE}/.intexuraos-release-sha"
}

validate_secret_candidate() {
  install -d -m 700 "${DEPLOY_HOME}/.cache/intexuraos-prod"
  CANDIDATE_WORK_DIR="$(mktemp -d "${DEPLOY_HOME}/.cache/intexuraos-prod/candidate.XXXXXX")"
  CANDIDATE_OUTPUT="${CANDIDATE_WORK_DIR}/projection"
  PRIVATE_PAYLOAD="${CANDIDATE_WORK_DIR}/payload.json"
  install -d -m 700 "${CANDIDATE_OUTPUT}"
  install -m 600 "${SECRET_PACKAGE_PAYLOAD_FILE}" "${PRIVATE_PAYLOAD}"
  (
    cd "${STAGING_RELEASE}"
    INTEXURAOS_ENVIRONMENT=prod \
      DEPLOY_HOME="${DEPLOY_HOME}" \
      DEPLOY_USER="${DEPLOY_USER}" \
      bash scripts/home-prod/load-secrets.sh \
        --user-projection \
        --validate-only \
        --candidate-output "${CANDIDATE_OUTPUT}" \
        --payload-file "${PRIVATE_PAYLOAD}" \
        --version "${SECRET_PACKAGE_VERSION}" >/dev/null
  ) || fail 'Home PROD secret candidate validation failed'
}

install_and_build() {
  (
    cd "${STAGING_RELEASE}"
    CI=true pnpm install --frozen-lockfile
    pnpm --recursive --filter '!@intexuraos/web' --if-present run build
  )
}

validate_runtime_candidate() {
  local rendered="${CANDIDATE_OUTPUT}/pm2-ecosystem.json"
  INTEXURAOS_COMMIT_SHA="${TARGET_SHA}" \
    INTEXURAOS_ENVIRONMENT=prod \
    INTEXURAOS_PROD_ENV_FILE="${CANDIDATE_OUTPUT}/.env.prod" \
    INTEXURAOS_PROD_PORT_OFFSET=10000 \
    INTEXURAOS_PROD_PROFILE=basic \
    HOME="${DEPLOY_HOME}" \
    node - "${STAGING_RELEASE}/ecosystem.config.prod.cjs" > "${rendered}" <<'NODE'
const path = require('node:path');
const config = require(path.resolve(process.argv[2]));
if (!config || !Array.isArray(config.apps) || config.apps.length === 0) process.exit(1);
const expectedNames = [
  'app-settings-service',
  'notion-service',
  'whatsapp-service',
  'mobile-notifications-service',
  'fishing-assistant-service',
  'notes-agent',
  'bookmarks-agent',
  'code-agent',
  'hellscript-agent',
  'llm-usage-service',
  'intex-agent',
  'user-service',
  'image-service',
  'calendar-agent',
  'linear-agent',
  'web-agent',
  'api-docs-hub',
];
const names = new Set();
const ports = new Set();
for (const app of config.apps) {
  const port = Number(app?.env?.PORT);
  if (typeof app?.name !== 'string' || names.has(app.name)) process.exit(1);
  if (app?.env?.HOST !== '127.0.0.1') {
    process.stderr.write(`PM2 app ${String(app?.name)} is not loopback-bound\n`);
    process.exit(1);
  }
  if (!Number.isInteger(port) || port < 18100 || port > 18199) {
    process.stderr.write(`PM2 app ${String(app?.name)} is outside the reserved Home PROD loopback port range\n`);
    process.exit(1);
  }
  if (ports.has(port)) process.exit(1);
  names.add(app.name);
  ports.add(port);
}
if (names.size !== expectedNames.length || expectedNames.some((name) => !names.has(name))) {
  process.stderr.write('PM2 candidate does not contain the exact Home PROD basic service set\n');
  process.exit(1);
}
if (names.has('research-agent') || names.has('message-digest-service')) process.exit(1);
process.stdout.write(JSON.stringify(config, null, 2));
NODE
  chmod 600 "${rendered}"
}

stage_web_candidate() {
  local message=""
  local source_date_epoch=""
  local final_web_release="${WEB_RELEASES_ROOT}/${TARGET_SHA}"
  message="$(git -C "${REPO_DIR}" show -s --format=%s "${TARGET_SHA}")"
  source_date_epoch="$(git -C "${REPO_DIR}" show -s --format=%ct "${TARGET_SHA}")"
  [[ "${source_date_epoch}" =~ ^[1-9][0-9]*$ ]] || fail 'Release commit timestamp is invalid'
  install -d -m 755 "${WEB_RELEASES_ROOT}"
  if [[ -e "${final_web_release}" || -L "${final_web_release}" ]]; then
    [[ -d "${final_web_release}" && ! -L "${final_web_release}" \
      && -f "${final_web_release}/index.html" ]] || fail 'Existing web release is unsafe'
    WEB_RELEASE_EXISTS="1"
  fi
  TEMP_WEB_RELEASE="$(mktemp -d "${WEB_RELEASES_ROOT}/.${TARGET_SHA}.XXXXXX")"
  COMMIT_SHA="${TARGET_SHA}" \
    COMMIT_MESSAGE="${message}" \
    SOURCE_DATE_EPOCH="${source_date_epoch}" \
    ENV_FILE="${CANDIDATE_OUTPUT}/.env.prod" \
    INTEXURAOS_ENVIRONMENT=prod \
    bash "${STAGING_RELEASE}/scripts/home-prod/deploy-web.sh" \
      --repo-dir "${STAGING_RELEASE}" \
      --env-file "${CANDIDATE_OUTPUT}/.env.prod" \
      --public-deployment-profile basic \
      --web-root "${TEMP_WEB_RELEASE}" >/dev/null
  [[ -f "${TEMP_WEB_RELEASE}/index.html" ]] || fail 'Candidate web release is incomplete'
  if [[ "${WEB_RELEASE_EXISTS}" == '1' ]]; then
    [[ -z "$(rsync -rcln --delete --itemize-changes \
      "${TEMP_WEB_RELEASE}/" "${final_web_release}/")" ]] \
      || fail 'Existing web release differs from the verified candidate'
  fi
}

check_candidate_ports() {
  local rendered="${CANDIDATE_OUTPUT}/pm2-ecosystem.json"
  local listeners="${CANDIDATE_OUTPUT}/listeners.txt"
  local pm2_apps="${CANDIDATE_OUTPUT}/running-pm2.json"
  local daemon_pid=""
  ss -H -ltnp > "${listeners}"
  if [[ -r "${PM2_HOME}/pm2.pid" ]] \
    && kill -0 "$(<"${PM2_HOME}/pm2.pid")" 2>/dev/null; then
    daemon_pid="$(<"${PM2_HOME}/pm2.pid")"
    pm2 jlist > "${pm2_apps}"
  else
    printf '[]\n' > "${pm2_apps}"
  fi
  if [[ -s "${listeners}" ]] && grep -Eq ':181[0-9]{2}([[:space:]]|$)' "${listeners}"; then
    [[ -n "${daemon_pid}" ]] || fail 'A reserved Home PROD port is occupied without the dedicated PM2 daemon'
    node "${STAGING_RELEASE}/scripts/home-prod/validate-port-ownership.mjs" \
      "${rendered}" "${listeners}" "${pm2_apps}" "${daemon_pid}" \
      || fail 'A reserved Home PROD port is occupied by a foreign process'
  fi
}

finalize_web_release() {
  local final_web_release="${WEB_RELEASES_ROOT}/${TARGET_SHA}"
  if [[ "${WEB_RELEASE_EXISTS}" == '1' ]]; then
    rm -rf -- "${TEMP_WEB_RELEASE}"
    TEMP_WEB_RELEASE=""
  else
    mv -T "${TEMP_WEB_RELEASE}" "${final_web_release}"
    TEMP_WEB_RELEASE=""
  fi
}

stop_running_pm2_apps() {
  local count="0"
  if [[ -r "${PM2_HOME}/pm2.pid" ]] \
    && kill -0 "$(<"${PM2_HOME}/pm2.pid")" 2>/dev/null; then
    count="$(pm2 jlist | node -e \
      'let v="";process.stdin.on("data",c=>v+=c);process.stdin.on("end",()=>process.stdout.write(String(JSON.parse(v).length)))')"
  fi
  if (( count > 0 )); then
    pm2 stop all >/dev/null
  fi
}

capture_activation_state() {
  if [[ -e "${CODE_CURRENT_LINK}" || -L "${CODE_CURRENT_LINK}" ]]; then
    [[ -L "${CODE_CURRENT_LINK}" ]] || fail 'Code current path is not a symlink'
    PREVIOUS_CODE_TARGET="$(readlink "${CODE_CURRENT_LINK}")"
    PREVIOUS_CODE_LINK_EXISTS="1"
  fi
  if [[ -e "${WEB_CURRENT_LINK}" || -L "${WEB_CURRENT_LINK}" ]]; then
    [[ -L "${WEB_CURRENT_LINK}" ]] || fail 'Web current path is not a symlink'
    PREVIOUS_WEB_TARGET="$(readlink "${WEB_CURRENT_LINK}")"
    PREVIOUS_WEB_LINK_EXISTS="1"
  fi
}

invalidate_saved_pm2_state() {
  rm -f -- "${EXPECTED_PM2_HOME}/dump.pm2" "${EXPECTED_PM2_HOME}/dump.pm2.bak"
}

publish_staged_release() {
  local release_dir="${STAGING_RELEASE}"
  local next_link=""
  finalize_web_release
  capture_activation_state
  ACTIVATION_STARTED="1"
  stop_running_pm2_apps
  invalidate_saved_pm2_state

  (
    cd "${release_dir}"
    INTEXURAOS_ENVIRONMENT=prod \
      DEPLOY_HOME="${DEPLOY_HOME}" \
      DEPLOY_USER="${DEPLOY_USER}" \
      bash scripts/home-prod/load-secrets.sh \
        --user-projection \
        --payload-file "${PRIVATE_PAYLOAD}" \
        --version "${SECRET_PACKAGE_VERSION}" >/dev/null
  )

  install -d -m 700 "$(dirname "${CODE_CURRENT_LINK}")"
  next_link="$(mktemp "${CODE_CURRENT_LINK}.next.XXXXXX")"
  rm -f -- "${next_link}"
  ln -s "${release_dir}" "${next_link}"
  mv -Tf "${next_link}" "${CODE_CURRENT_LINK}"

  install -d -m 755 "$(dirname "${WEB_CURRENT_LINK}")"
  next_link="$(mktemp "${WEB_CURRENT_LINK}.next.XXXXXX")"
  rm -f -- "${next_link}"
  ln -s "${WEB_RELEASES_ROOT}/${TARGET_SHA}" "${next_link}"
  mv -Tf "${next_link}" "${WEB_CURRENT_LINK}"

  (
    cd "${release_dir}"
    INTEXURAOS_COMMIT_SHA="${TARGET_SHA}" \
      INTEXURAOS_ENVIRONMENT=prod \
      INTEXURAOS_PROD_ENV_FILE="${PROD_ENV_FILE}" \
      INTEXURAOS_PROD_PORT_OFFSET=10000 \
      INTEXURAOS_PROD_PROFILE=basic \
      PM2_HOME="${EXPECTED_PM2_HOME}" \
      bash scripts/home-prod/reload-pm2.sh \
        --config ecosystem.config.prod.cjs \
        --rendered-config "${PROD_CONFIG_ROOT}/pm2-ecosystem.json"
  )

  ACTIVATION_SUCCEEDED="1"
  # The installed dependency tree contains absolute paths. Its unique attempt
  # directory is therefore already final and becomes immutable at activation.
  TEMP_RELEASE=""
}

main() {
  parse_args "$@"
  require_preconditions
  umask 077
  acquire_lock
  resolve_release
  prepare_release_tree
  install_and_build
  validate_secret_candidate
  validate_runtime_candidate
  stage_web_candidate
  check_candidate_ports
  git -C "${REPO_DIR}" checkout --quiet --detach "${TARGET_SHA}"
  publish_staged_release
  printf 'Home PROD release activated: %s (secret package v%s)\n' \
    "${TARGET_SHA}" "${SECRET_PACKAGE_VERSION}"
}

main "$@"
