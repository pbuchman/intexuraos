#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

readonly DEPLOY_USER='intexuraos-prod'
readonly DEPLOY_GROUP='intexuraos-prod'
readonly DEPLOY_HOME='/home/intexuraos-prod'
readonly PM2_HOME_PATH='/home/intexuraos-prod/.pm2-intexuraos-prod'
readonly CANDIDATE_ROOT='/var/lib/intexuraos-home-prod/candidates'
readonly PROVISIONER_KEY='/etc/intexuraos-home-prod/provisioner-sa-key.json'
readonly USER_DEPLOY_DRIVER='/usr/local/libexec/intexuraos-home-prod-deploy-user'
readonly SYSTEMD_UNIT='intexuraos-home-prod-pm2.service'
readonly PROJECT_ID='intexuraos-dev-pbuchman'
readonly SECRET_ID='INTEXURAOS_SECRET_PACKAGE_PROD'
readonly LOCK_FILE='/run/lock/intexuraos-home-prod/deploy.lock'
readonly SAFE_PATH='/usr/local/lib/intexuraos-home-prod/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'

CANDIDATE_DIR=''
LOCK_FD=''

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

cleanup() {
  local status=$?
  trap - EXIT
  set +e
  if [[ -n "${CANDIDATE_DIR}" && -d "${CANDIDATE_DIR}" ]]; then
    rm -rf -- "${CANDIDATE_DIR}"
  fi
  exit "${status}"
}
trap cleanup EXIT

validate_args() {
  [[ $# -eq 2 ]] || fail 'Usage: intexuraos-home-prod-deploy <40hex-sha> <positive-secret-version>'
  [[ "$1" =~ ^[0-9a-f]{40}$ ]] \
    || fail 'Release SHA must be exactly 40 lowercase hexadecimal characters'
  [[ "$2" =~ ^[1-9][0-9]*$ ]] \
    || fail 'Secret package version must be an exact positive integer'
}

validate_fixed_boundary() {
  [[ "${EUID}" -eq 0 ]] || fail 'The Home PROD launcher must run as root'
  [[ -x "${USER_DEPLOY_DRIVER}" && ! -L "${USER_DEPLOY_DRIVER}" ]] \
    || fail 'The fixed user deployment driver is unavailable'
  [[ "$(stat -c '%U:%G:%a:%F' "${USER_DEPLOY_DRIVER}")" == \
    'root:root:755:regular file' ]] || fail 'The fixed user deployment driver ownership or mode is unsafe'
  [[ -f "${PROVISIONER_KEY}" && ! -L "${PROVISIONER_KEY}" ]] \
    || fail 'The root-owned provisioner credential is unavailable'
  [[ "$(stat -c '%U:%G:%a:%F' "${PROVISIONER_KEY}")" == 'root:root:600:regular file' ]] \
    || fail 'The provisioner credential ownership or mode is unsafe'
  [[ "$(stat -c '%U:%G:%a:%F' "${CANDIDATE_ROOT}")" == "root:${DEPLOY_GROUP}:750:directory" ]] \
    || fail 'The candidate root ownership or mode is unsafe'
  [[ "$(stat -c '%U:%G:%a:%F' '/var/lib/intexuraos-home-prod')" == \
    'root:root:711:directory' ]] || fail 'The candidate parent ownership or mode is unsafe'
  [[ ! -L '/var/lib/intexuraos-home-prod' && ! -L "${CANDIDATE_ROOT}" ]] \
    || fail 'The candidate root must not contain symlinks'
  id -u "${DEPLOY_USER}" >/dev/null 2>&1 || fail 'The dedicated deployment user is missing'
}

fetch_candidate() {
  local version="$1"
  local temporary=''
  CANDIDATE_DIR="$(mktemp -d "${CANDIDATE_ROOT}/candidate.XXXXXX")"
  chown root:"${DEPLOY_GROUP}" "${CANDIDATE_DIR}"
  chmod 750 "${CANDIDATE_DIR}"
  temporary="${CANDIDATE_DIR}/payload.next"
  env -i \
    HOME=/root \
    LANG=C \
    LC_ALL=C \
    PATH="${SAFE_PATH}" \
    CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="${PROVISIONER_KEY}" \
    timeout --signal=TERM --kill-after=5 30 \
      gcloud secrets versions access "${version}" \
        --quiet \
        --project="${PROJECT_ID}" \
        --secret="${SECRET_ID}" > "${temporary}"
  [[ -s "${temporary}" && ! -L "${temporary}" ]] || fail 'Fetched secret package candidate is empty or unsafe'
  chown root:"${DEPLOY_GROUP}" "${temporary}"
  chmod 440 "${temporary}"
  mv -T "${temporary}" "${CANDIDATE_DIR}/payload.json"
  [[ "$(stat -c '%U:%G:%a:%F' "${CANDIDATE_DIR}/payload.json")" == \
    "root:${DEPLOY_GROUP}:440:regular file" ]] || fail 'Candidate payload ownership or mode is unsafe'
}

run_user_deployment() {
  local sha="$1"
  local version="$2"
  env -i \
    HOME="${DEPLOY_HOME}" \
    LANG=C \
    LC_ALL=C \
    PATH="${SAFE_PATH}" \
    PM2_HOME="${PM2_HOME_PATH}" \
    USER="${DEPLOY_USER}" \
    LOGNAME="${DEPLOY_USER}" \
    runuser -u "${DEPLOY_USER}" -- \
      "${USER_DEPLOY_DRIVER}" "${sha}" "${version}" "${CANDIDATE_DIR}/payload.json"
}

ensure_pm2_service() {
  local daemon_pid=''
  local control_group=''
  if systemctl is-active --quiet "${SYSTEMD_UNIT}"; then
    if [[ -r "${PM2_HOME_PATH}/pm2.pid" ]]; then
      daemon_pid="$(<"${PM2_HOME_PATH}/pm2.pid")"
    fi
    if [[ ! "${daemon_pid}" =~ ^[1-9][0-9]*$ ]] || ! kill -0 "${daemon_pid}" 2>/dev/null; then
      systemctl restart "${SYSTEMD_UNIT}"
    fi
  else
    if [[ -r "${PM2_HOME_PATH}/pm2.pid" ]]; then
      daemon_pid="$(<"${PM2_HOME_PATH}/pm2.pid")"
      if [[ "${daemon_pid}" =~ ^[1-9][0-9]*$ ]] && kill -0 "${daemon_pid}" 2>/dev/null; then
        fail 'A live dedicated PM2 daemon exists outside the inactive systemd unit'
      fi
    fi
    systemctl reset-failed "${SYSTEMD_UNIT}" || true
    systemctl start "${SYSTEMD_UNIT}"
  fi
  systemctl is-active --quiet "${SYSTEMD_UNIT}" \
    || fail "${SYSTEMD_UNIT} did not become active"
  [[ -r "${PM2_HOME_PATH}/pm2.pid" ]] || fail 'Dedicated PM2 daemon pid is missing'
  daemon_pid="$(<"${PM2_HOME_PATH}/pm2.pid")"
  if [[ ! "${daemon_pid}" =~ ^[1-9][0-9]*$ ]] || ! kill -0 "${daemon_pid}" 2>/dev/null; then
    fail 'Dedicated PM2 daemon is not running'
  fi
  control_group="$(systemctl show "${SYSTEMD_UNIT}" --property=ControlGroup --value)"
  [[ -n "${control_group}" ]] || fail 'Dedicated PM2 unit cgroup is unavailable'
  grep -Fq -- "${control_group}" "/proc/${daemon_pid}/cgroup" \
    || fail 'Dedicated PM2 daemon is outside its systemd unit cgroup'
}

main() {
  validate_args "$@"
  validate_fixed_boundary
  umask 077
  install -d -m 700 /run/lock/intexuraos-home-prod
  : > "${LOCK_FILE}"
  chmod 600 "${LOCK_FILE}"
  exec {LOCK_FD}<>"${LOCK_FILE}"
  flock --exclusive --wait 60 "${LOCK_FD}" || fail 'Timed out waiting for the privileged deployment lock'
  fetch_candidate "$2"
  ensure_pm2_service
  run_user_deployment "$1" "$2"
}

main "$@"
