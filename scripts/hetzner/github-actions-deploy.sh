#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

HETZNER_PROD_HOST="${HETZNER_PROD_HOST:-162.55.210.48}"
REMOTE_USER="${REMOTE_USER:-deploy}"
REMOTE_REPO_DIR="${REMOTE_REPO_DIR:-/opt/intexuraos}"
REMOTE_RELEASES_DIR="${REMOTE_REPO_DIR%/}/releases"
REMOTE_RELEASE_DIR=""
REMOTE_CUTOVER_STATE_PATH="${REMOTE_REPO_DIR%/}/.deployment-state/message-digests/state.json"
PUBLIC_DOMAIN="${PUBLIC_DOMAIN:-intexuraos.cloud}"
SSH_PORT="${SSH_PORT:-22}"
DEPLOY_NGINX="${DEPLOY_NGINX:-true}"
DEPLOYMENT_JSON_PATH="/var/www/intexuraos/web/current/deployment.json"
LEGACY_DEPLOYMENT_JSON_PATH="${LEGACY_DEPLOYMENT_JSON_PATH:-/var/www/intexuraos/web/dist/deployment.json}"
KEY_FILE=""
KNOWN_HOSTS_FILE=""
SYNC_SOURCE_DIR=""
RELEASE_ATTESTATION_FILE=""
DEPLOYMENT_RESPONSE_HEADERS_FILE=""
CODE_HEALTH_RESPONSE_HEADERS_FILE=""
CODE_HEALTH_RESPONSE_BODY_FILE=""
LOCAL_COMMIT_SHA_VALUE=""
COMMIT_SHA_VALUE=""
COMMIT_MESSAGE_VALUE=""
WORKFLOW_RUN_ID_VALUE="manual"
ACTIVATION_MODE=""
PREVIOUS_RELEASE_DIR=""
PREVIOUS_RELEASE_SHA=""
RELEASE_MANIFEST_HASH=""
TESTED_TREE_VALUE=""
DEPLOYMENT_METADATA_PUBLISHED="false"
DEPLOYMENT_ATTESTATION_VERIFIED="false"
RETIRED_REMOTE_PATHS=(
  "packages/infra-otel"
)

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

cleanup() {
  local exit_status=$?

  set +e
  if [[ "${DEPLOYMENT_METADATA_PUBLISHED}" == "true" && "${DEPLOYMENT_ATTESTATION_VERIFIED}" != "true" ]]; then
    if ! withdraw_deployment_metadata; then
      printf 'ERROR: Could not withdraw unverified deployment attestation\n' >&2
    fi
  fi
  [[ -n "${KEY_FILE}" ]] && rm -f "${KEY_FILE}"
  [[ -n "${KNOWN_HOSTS_FILE}" ]] && rm -f "${KNOWN_HOSTS_FILE}"
  [[ -n "${DEPLOYMENT_RESPONSE_HEADERS_FILE}" ]] && rm -f "${DEPLOYMENT_RESPONSE_HEADERS_FILE}"
  [[ -n "${CODE_HEALTH_RESPONSE_HEADERS_FILE}" ]] && rm -f "${CODE_HEALTH_RESPONSE_HEADERS_FILE}"
  [[ -n "${CODE_HEALTH_RESPONSE_BODY_FILE}" ]] && rm -f "${CODE_HEALTH_RESPONSE_BODY_FILE}"
  [[ -n "${RELEASE_ATTESTATION_FILE}" ]] && rm -f "${RELEASE_ATTESTATION_FILE}"
  if [[ -n "${SYNC_SOURCE_DIR}" && -d "${SYNC_SOURCE_DIR}" ]]; then
    rm -rf -- "${SYNC_SOURCE_DIR}"
  fi
  return "${exit_status}"
}

require_command() {
  local command_name="$1"
  command -v "${command_name}" >/dev/null 2>&1 || fail "${command_name} is required"
}

validate_inputs() {
  [[ -n "${HETZNER_DEPLOY_SSH_PRIVATE_KEY:-}" ]] \
    || fail "HETZNER_DEPLOY_SSH_PRIVATE_KEY is required"
  [[ -n "${HETZNER_PROD_HOST}" ]] || fail "HETZNER_PROD_HOST is required"
  [[ -n "${REMOTE_USER}" ]] || fail "REMOTE_USER is required"
  [[ -n "${REMOTE_REPO_DIR}" ]] || fail "REMOTE_REPO_DIR is required"
  [[ "${SSH_PORT}" =~ ^[0-9]+$ ]] || fail "SSH_PORT must be numeric"

  case "${DEPLOY_NGINX}" in
    true|false) ;;
    *) fail "DEPLOY_NGINX must be true or false" ;;
  esac
}

resolve_commit_metadata() {
  local worktree_status=""

  LOCAL_COMMIT_SHA_VALUE="$(git rev-parse HEAD)"
  worktree_status="$(git status --porcelain=v1 --untracked-files=all)"

  if [[ -n "${worktree_status}" ]]; then
    fail "Local checkout contains tracked or untracked changes"
  fi

  if [[ -n "${GITHUB_SHA:-}" && "${LOCAL_COMMIT_SHA_VALUE}" != "${GITHUB_SHA}" ]]; then
    fail "Local checkout SHA does not match GITHUB_SHA"
  fi

  COMMIT_SHA_VALUE="${GITHUB_SHA:-${LOCAL_COMMIT_SHA_VALUE}}"
  REMOTE_RELEASE_DIR="${REMOTE_REPO_DIR%/}/releases/${COMMIT_SHA_VALUE}"
  COMMIT_MESSAGE_VALUE="${GITHUB_COMMIT_MESSAGE:-}"
  if [[ -n "${GITHUB_RUN_ID:-}" ]]; then
    WORKFLOW_RUN_ID_VALUE="${GITHUB_RUN_ID}"
  fi

  if [[ -z "${COMMIT_MESSAGE_VALUE}" ]]; then
    COMMIT_MESSAGE_VALUE="$(git log -1 --pretty=%s)"
  fi

  [[ -n "${COMMIT_SHA_VALUE}" ]] || fail "Could not resolve COMMIT_SHA"
  [[ -n "${COMMIT_MESSAGE_VALUE}" ]] || fail "Could not resolve COMMIT_MESSAGE"
  [[ "${COMMIT_SHA_VALUE}" =~ ^[0-9a-f]{40}$ ]] || fail "COMMIT_SHA must be a 40-character lowercase hexadecimal SHA"
  [[ "${WORKFLOW_RUN_ID_VALUE}" == "manual" || "${WORKFLOW_RUN_ID_VALUE}" =~ ^[0-9]+$ ]] \
    || fail "GITHUB_RUN_ID must be numeric"
}

prepare_sync_source() {
  SYNC_SOURCE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/intexuraos-deploy-tree.XXXXXX")"
  git archive "${COMMIT_SHA_VALUE}" | tar -xf - -C "${SYNC_SOURCE_DIR}"
  RELEASE_MANIFEST_HASH="$(node "${SYNC_SOURCE_DIR}/scripts/hetzner/hash-release-tree.mjs" "${SYNC_SOURCE_DIR}")"
  [[ "${RELEASE_MANIFEST_HASH}" =~ ^[0-9a-f]{64}$ ]] \
    || fail "Could not derive the immutable release manifest"
}

json_file_field() {
  local path="$1"
  local field="$2"
  node -e '
const { readFileSync } = require("node:fs");
const value = JSON.parse(readFileSync(process.argv[1], "utf8"));
const field = process.argv[2];
if (typeof value?.[field] !== "string") process.exit(1);
process.stdout.write(value[field]);
' "${path}" "${field}"
}

verify_cutover_release_attestation() {
  [[ -n "${GH_TOKEN:-${GITHUB_TOKEN:-}}" ]] \
    || fail "GH_TOKEN is required for the first Message Digest activation"
  [[ -n "${GITHUB_REPOSITORY:-}" ]] \
    || fail "GITHUB_REPOSITORY is required for the first Message Digest activation"
  RELEASE_ATTESTATION_FILE="$(mktemp "${TMPDIR:-/tmp}/message-digest-release.XXXXXX.json")"
  node scripts/hetzner/verify-github-message-digest-release.mjs > "${RELEASE_ATTESTATION_FILE}"
  TESTED_TREE_VALUE="$(json_file_field "${RELEASE_ATTESTATION_FILE}" testedTree)"
  [[ "$(json_file_field "${RELEASE_ATTESTATION_FILE}" mergeSha)" == "${COMMIT_SHA_VALUE}" ]] \
    || fail "Verified merge SHA does not match the deployment release"
  [[ "${TESTED_TREE_VALUE}" =~ ^[0-9a-f]{40}$ ]] \
    || fail "Verified tested tree is invalid"
}

setup_ssh() {
  KEY_FILE="$(mktemp "${TMPDIR:-/tmp}/intexuraos-hetzner-key.XXXXXX")"
  KNOWN_HOSTS_FILE="$(mktemp "${TMPDIR:-/tmp}/intexuraos-hetzner-known-hosts.XXXXXX")"
  chmod 600 "${KEY_FILE}" "${KNOWN_HOSTS_FILE}"

  printf '%s\n' "${HETZNER_DEPLOY_SSH_PRIVATE_KEY}" | tr -d '\r' > "${KEY_FILE}"
  chmod 600 "${KEY_FILE}"

  ssh-keyscan -p "${SSH_PORT}" -H "${HETZNER_PROD_HOST}" >> "${KNOWN_HOSTS_FILE}"
}

ssh_command_string() {
  printf 'ssh -i %q -p %q -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=%q' \
    "${KEY_FILE}" \
    "${SSH_PORT}" \
    "${KNOWN_HOSTS_FILE}"
}

run_remote_at() {
  local directory="$1"
  local command="$2"
  local quoted_directory=""

  printf -v quoted_directory '%q' "${directory}"
  ssh -i "${KEY_FILE}" \
    -p "${SSH_PORT}" \
    -o BatchMode=yes \
    -o StrictHostKeyChecking=yes \
    -o UserKnownHostsFile="${KNOWN_HOSTS_FILE}" \
    "${REMOTE_USER}@${HETZNER_PROD_HOST}" \
    "cd ${quoted_directory} && ${command}"
}

run_remote() {
  [[ -n "${REMOTE_RELEASE_DIR}" ]] || fail "Remote release directory is unresolved"
  run_remote_at "${REMOTE_RELEASE_DIR}" "$1"
}

read_remote_cutover_status() {
  local state_path_quoted=""
  printf -v state_path_quoted '%q' "${REMOTE_CUTOVER_STATE_PATH}"
  run_remote_at "${REMOTE_REPO_DIR}" \
    "if [[ ! -f ${state_path_quoted} ]]; then printf absent; else node -e 'const { readFileSync } = require(\"node:fs\"); const state = JSON.parse(readFileSync(process.argv[1], \"utf8\")); if (![\"in_progress\",\"compensating\",\"compensated\",\"admitting\",\"admitted\",\"complete\"].includes(state.status)) process.exit(1); process.stdout.write(state.status);' ${state_path_quoted}; fi"
}

read_remote_cutover_field() {
  local field="$1"
  local state_path_quoted=""
  local field_quoted=""
  printf -v state_path_quoted '%q' "${REMOTE_CUTOVER_STATE_PATH}"
  printf -v field_quoted '%q' "${field}"
  run_remote_at "${REMOTE_REPO_DIR}" \
    "node -e 'const { readFileSync } = require(\"node:fs\"); const state = JSON.parse(readFileSync(process.argv[1], \"utf8\")); const value = state[process.argv[2]]; if (typeof value !== \"string\") process.exit(1); process.stdout.write(value);' ${state_path_quoted} ${field_quoted}"
}

validate_previous_release() {
  [[ "${PREVIOUS_RELEASE_DIR}" =~ ^${REMOTE_RELEASES_DIR}/[0-9a-f]{40}$ ]] \
    || fail "Previous immutable release path is invalid"
  PREVIOUS_RELEASE_SHA="$(basename "${PREVIOUS_RELEASE_DIR}")"
  [[ "${PREVIOUS_RELEASE_SHA}" =~ ^[0-9a-f]{40}$ ]] \
    || fail "Previous immutable release SHA is invalid"
  [[ "${PREVIOUS_RELEASE_DIR}" != "${REMOTE_RELEASE_DIR}" ]] \
    || fail "Candidate release cannot also be the previous immutable release"
}

snapshot_legacy_release() {
  local releases_dir_quoted=""
  local previous_dir_quoted=""
  local repo_dir_quoted=""
  PREVIOUS_RELEASE_SHA="$(read_served_deployment_sha)"
  [[ "${PREVIOUS_RELEASE_SHA}" =~ ^[0-9a-f]{40}$ ]] \
    || fail "Current production deployment attestation has no exact SHA"
  PREVIOUS_RELEASE_DIR="${REMOTE_RELEASES_DIR}/${PREVIOUS_RELEASE_SHA}"
  validate_previous_release
  printf -v releases_dir_quoted '%q' "${REMOTE_RELEASES_DIR}"
  printf -v previous_dir_quoted '%q' "${PREVIOUS_RELEASE_DIR}"
  printf -v repo_dir_quoted '%q' "${REMOTE_REPO_DIR%/}/"
  run_remote_at "${REMOTE_REPO_DIR}" \
    "install -d -m 755 ${releases_dir_quoted} ${previous_dir_quoted}; rsync -a --delete --exclude '/releases/' --exclude '/.deployment-state/' ${repo_dir_quoted} ${previous_dir_quoted}/; test -f ${previous_dir_quoted}/ecosystem.config.prod.cjs"
}

read_served_deployment_sha() {
  local active_path_quoted=""
  local legacy_path_quoted=""
  printf -v active_path_quoted '%q' "${DEPLOYMENT_JSON_PATH}"
  printf -v legacy_path_quoted '%q' "${LEGACY_DEPLOYMENT_JSON_PATH}"
  run_remote_at "${REMOTE_REPO_DIR}" \
    "node -e 'const { existsSync, lstatSync, readFileSync } = require(\"node:fs\"); const { dirname } = require(\"node:path\"); const [active, legacy] = process.argv.slice(1); let activeLayoutExists = existsSync(active); if (!activeLayoutExists) { try { lstatSync(dirname(active)); activeLayoutExists = true; } catch {} } const selected = activeLayoutExists ? active : legacy; const value = JSON.parse(readFileSync(selected, \"utf8\")); if (!/^[0-9a-f]{40}$/.test(value.commitSha)) process.exit(1); process.stdout.write(value.commitSha);' ${active_path_quoted} ${legacy_path_quoted}"
}

resolve_activation_context() {
  local status=""
  local current_link_quoted=""
  local completed_merge_sha=""
  local completed_release_dir=""
  status="$(read_remote_cutover_status)"
  case "${status}" in
    absent)
      ACTIVATION_MODE="cutover"
      verify_cutover_release_attestation
      snapshot_legacy_release
      ;;
    in_progress|compensated|admitting|admitted)
      ACTIVATION_MODE="cutover"
      verify_cutover_release_attestation
      PREVIOUS_RELEASE_DIR="$(read_remote_cutover_field previousReleaseDir)"
      validate_previous_release
      ;;
    compensating)
      fail "Previous Message Digest compensation is incomplete"
      ;;
    complete)
      completed_merge_sha="$(read_remote_cutover_field mergeSha)"
      if [[ "${completed_merge_sha}" == "${COMMIT_SHA_VALUE}" ]]; then
        ACTIVATION_MODE="cutover_complete"
        verify_cutover_release_attestation
        completed_release_dir="$(read_remote_cutover_field releaseDir)"
        [[ "${completed_release_dir}" == "${REMOTE_RELEASE_DIR}" ]] \
          || fail "Completed Message Digest release does not match this deployment"
        PREVIOUS_RELEASE_DIR="$(read_remote_cutover_field previousReleaseDir)"
        validate_previous_release
      else
        ACTIVATION_MODE="ordinary"
        printf -v current_link_quoted '%q' "${REMOTE_REPO_DIR%/}/current"
        PREVIOUS_RELEASE_DIR="$(run_remote_at "${REMOTE_REPO_DIR}" \
          "test -L ${current_link_quoted}; readlink -f ${current_link_quoted}")"
        validate_previous_release
      fi
      ;;
    *)
      fail "Remote Message Digest activation state is invalid"
      ;;
  esac
}

sync_repo() {
  local ssh_command=""
  local release_parent_quoted=""
  local release_dir_quoted=""

  ssh_command="$(ssh_command_string)"
  printf -v release_parent_quoted '%q' "${REMOTE_RELEASES_DIR}"
  printf -v release_dir_quoted '%q' "${REMOTE_RELEASE_DIR}"
  run_remote_at "${REMOTE_REPO_DIR}" \
    "install -d -m 755 ${release_parent_quoted} ${release_dir_quoted}"
  rsync -az --delete \
    --exclude '.git/' \
    --exclude '.terraform/' \
    --exclude 'node_modules/' \
    --exclude 'dist/' \
    --exclude 'coverage/' \
    --exclude '*.tfstate' \
    --exclude '*.tfstate.*' \
    -e "${ssh_command}" \
    "${SYNC_SOURCE_DIR%/}/" "${REMOTE_USER}@${HETZNER_PROD_HOST}:${REMOTE_RELEASE_DIR%/}/"
}

verify_remote_release_manifest() {
  local expected_hash_quoted=""
  local release_dir_quoted=""
  printf -v expected_hash_quoted '%q' "${RELEASE_MANIFEST_HASH}"
  printf -v release_dir_quoted '%q' "${REMOTE_RELEASE_DIR}"
  run_remote \
    "observed_hash=\$(node scripts/hetzner/hash-release-tree.mjs ${release_dir_quoted}); [[ \"\${observed_hash}\" == ${expected_hash_quoted} ]]"
}

cleanup_retired_remote_paths() {
  local path=""
  local path_quoted=""

  for path in "${RETIRED_REMOTE_PATHS[@]}"; do
    printf -v path_quoted '%q' "${path}"
    run_remote "if [[ -e ${path_quoted} || -L ${path_quoted} ]]; then printf 'Removing retired remote path: %s\n' ${path_quoted}; rm -rf -- ${path_quoted}; fi"
  done
}

withdraw_deployment_metadata() {
  local deployment_path_quoted=""

  printf -v deployment_path_quoted '%q' "${DEPLOYMENT_JSON_PATH}"
  run_remote "rm -f -- ${deployment_path_quoted}"
}

run_remote_deploy_web() {
  local commit_sha_quoted=""
  local commit_message_quoted=""

  printf -v commit_sha_quoted '%q' "${COMMIT_SHA_VALUE}"
  printf -v commit_message_quoted '%q' "${COMMIT_MESSAGE_VALUE}"
  run_remote "COMMIT_SHA=${commit_sha_quoted} COMMIT_MESSAGE=${commit_message_quoted} INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/deploy-web.sh"
}

prepare_runtime_dependencies() {
  run_remote 'sudo -n INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/load-secrets.sh'
  run_remote 'sudo -n INTEXURAOS_ENVIRONMENT=prod bash scripts/observability/install-grafana-alloy.sh'
  run_remote 'sudo -n INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/install-pm2-logrotate.sh'
  run_remote 'CI=true pnpm install --frozen-lockfile'
}

deploy_runtime() {
  local commit_sha_quoted=""
  printf -v commit_sha_quoted '%q' "${COMMIT_SHA_VALUE}"
  run_remote "INTEXURAOS_COMMIT_SHA=${commit_sha_quoted} INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/reload-pm2.sh"
}

run_message_digest_cutover() {
  local cutover_start=""
  local release_dir_quoted=""
  local previous_dir_quoted=""
  local previous_sha_quoted=""
  local merge_sha_quoted=""
  local tested_tree_quoted=""
  local deployment_id_quoted=""
  local manifest_hash_quoted=""
  local cutover_start_quoted=""
  cutover_start="$(date -u +'%Y-%m-%dT%H:%M:%S.000Z')"
  printf -v release_dir_quoted '%q' "${REMOTE_RELEASE_DIR}"
  printf -v previous_dir_quoted '%q' "${PREVIOUS_RELEASE_DIR}"
  printf -v previous_sha_quoted '%q' "${PREVIOUS_RELEASE_SHA}"
  printf -v merge_sha_quoted '%q' "${COMMIT_SHA_VALUE}"
  printf -v tested_tree_quoted '%q' "${TESTED_TREE_VALUE}"
  printf -v deployment_id_quoted '%q' "${WORKFLOW_RUN_ID_VALUE}"
  printf -v manifest_hash_quoted '%q' "${RELEASE_MANIFEST_HASH}"
  printf -v cutover_start_quoted '%q' "${cutover_start}"
  run_remote \
    "RELEASE_DIR=${release_dir_quoted} PREVIOUS_RELEASE_DIR=${previous_dir_quoted} PREVIOUS_RELEASE_SHA=${previous_sha_quoted} MERGE_SHA=${merge_sha_quoted} TESTED_TREE=${tested_tree_quoted} DEPLOYMENT_ID=${deployment_id_quoted} RELEASE_MANIFEST_HASH=${manifest_hash_quoted} CUTOVER_START=${cutover_start_quoted} bash scripts/hetzner/cutover-message-digests.sh"
}

point_current_release() {
  local current_link_quoted=""
  local release_dir_quoted=""
  printf -v current_link_quoted '%q' "${REMOTE_REPO_DIR%/}/current"
  printf -v release_dir_quoted '%q' "${REMOTE_RELEASE_DIR}"
  run_remote_at "${REMOTE_REPO_DIR}" "ln -sfn ${release_dir_quoted} ${current_link_quoted}"
}

deploy_web_and_edge() {
  run_remote_deploy_web

  if [[ "${DEPLOY_NGINX}" == "true" ]]; then
    run_remote 'sudo -n INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/deploy-nginx.sh'
  fi
}

verify_code_agent_health() {
  local label="$1"
  local url="$2"
  local status=""
  shift 2

  CODE_HEALTH_RESPONSE_HEADERS_FILE="$(mktemp "${TMPDIR:-/tmp}/intexuraos-code-health-headers.XXXXXX")"
  CODE_HEALTH_RESPONSE_BODY_FILE="$(mktemp "${TMPDIR:-/tmp}/intexuraos-code-health-body.XXXXXX")"
  status="$(curl --silent --show-error --max-time 15 \
    --dump-header "${CODE_HEALTH_RESPONSE_HEADERS_FILE}" \
    --output "${CODE_HEALTH_RESPONSE_BODY_FILE}" \
    --write-out '%{http_code}' \
    "$@" "${url}")"

  if ! node scripts/hetzner/verify-code-agent-health.mjs \
    "${status}" "${CODE_HEALTH_RESPONSE_HEADERS_FILE}" < "${CODE_HEALTH_RESPONSE_BODY_FILE}"; then
    fail "Code-agent semantic health contract failed through ${label}"
  fi

  rm -f "${CODE_HEALTH_RESPONSE_HEADERS_FILE}" "${CODE_HEALTH_RESPONSE_BODY_FILE}"
  CODE_HEALTH_RESPONSE_HEADERS_FILE=""
  CODE_HEALTH_RESPONSE_BODY_FILE=""
}

verify_code_agent_readiness() {
  verify_code_agent_health \
    "direct origin" \
    "https://${PUBLIC_DOMAIN}/api/code/health" \
    --resolve "${PUBLIC_DOMAIN}:443:${HETZNER_PROD_HOST}"
  verify_code_agent_health \
    "public DNS" \
    "https://${PUBLIC_DOMAIN}/api/code/health"
}

verify_backend_readiness() {
  run_remote 'curl --fail --silent --show-error --max-time 10 http://127.0.0.1/api/whatsapp/health >/dev/null'
  run_remote 'curl --fail --silent --show-error --max-time 10 http://127.0.0.1/api/intex-agent/health >/dev/null'
  run_remote 'INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/verify-matrix-corpus-runtime.sh'
  curl --fail --silent --show-error --max-time 15 \
    --resolve "${PUBLIC_DOMAIN}:443:${HETZNER_PROD_HOST}" \
    "https://${PUBLIC_DOMAIN}/api/whatsapp/health" >/dev/null
  verify_code_agent_readiness
}

publish_deployment_metadata() {
  local deployed_at=""
  local deployment_json=""
  local deployment_json_quoted=""
  local deployment_path_quoted=""
  local remote_publish_command=""

  deployed_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  printf -v deployment_json \
    '{"commitSha":"%s","workflowRunId":"%s","deployedAt":"%s"}' \
    "${COMMIT_SHA_VALUE}" \
    "${WORKFLOW_RUN_ID_VALUE}" \
    "${deployed_at}"
  printf -v deployment_json_quoted '%q' "${deployment_json}"
  printf -v deployment_path_quoted '%q' "${DEPLOYMENT_JSON_PATH}"

  IFS= read -r -d '' remote_publish_command <<'REMOTE_COMMAND' || true
deployment_tmp="$(mktemp "${DEPLOYMENT_JSON_PATH}.XXXXXX")"
trap "rm -f -- \"${deployment_tmp}\"" EXIT
printf "%s" "${DEPLOYMENT_JSON}" > "${deployment_tmp}"
chmod 644 "${deployment_tmp}"
mv -f -- "${deployment_tmp}" "${DEPLOYMENT_JSON_PATH}"
trap - EXIT
REMOTE_COMMAND

  DEPLOYMENT_METADATA_PUBLISHED="true"
  run_remote "DEPLOYMENT_JSON_PATH=${deployment_path_quoted}; DEPLOYMENT_JSON=${deployment_json_quoted}; ${remote_publish_command}"
}

verify_non_404_route() {
  local route_path="$1"
  local status=""

  status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 15 \
    --request POST \
    --resolve "${PUBLIC_DOMAIN}:443:${HETZNER_PROD_HOST}" \
    "https://${PUBLIC_DOMAIN}${route_path}")"

  if [[ "${status}" == "404" ]]; then
    fail "Code-agent callback route returned 404: ${route_path}"
  fi
}

verify_deployment_document() {
  local label="$1"
  local url="$2"
  local response=""
  shift 2

  DEPLOYMENT_RESPONSE_HEADERS_FILE="$(mktemp "${TMPDIR:-/tmp}/intexuraos-deployment-headers.XXXXXX")"

  if ! response="$(curl --fail --silent --show-error --max-time 15 \
    --dump-header "${DEPLOYMENT_RESPONSE_HEADERS_FILE}" \
    "$@" "${url}")"; then
    fail "Could not read deployment attestation through ${label}"
  fi

  if ! node scripts/hetzner/verify-deployment-document.mjs \
    "${COMMIT_SHA_VALUE}" \
    "${WORKFLOW_RUN_ID_VALUE}" \
    "${DEPLOYMENT_RESPONSE_HEADERS_FILE}" <<< "${response}"; then
    fail "Deployment attestation or response headers did not match the exact release contract through ${label}"
  fi

  rm -f "${DEPLOYMENT_RESPONSE_HEADERS_FILE}"
  DEPLOYMENT_RESPONSE_HEADERS_FILE=""
}

verify_runtime_readiness() {
  run_remote 'curl --fail --silent --show-error --max-time 10 http://127.0.0.1/healthz >/dev/null'
  curl --fail --silent --show-error --max-time 15 \
    --resolve "${PUBLIC_DOMAIN}:443:${HETZNER_PROD_HOST}" \
    "https://${PUBLIC_DOMAIN}/healthz" >/dev/null
  curl --fail --silent --show-error --max-time 15 \
    --resolve "${PUBLIC_DOMAIN}:443:${HETZNER_PROD_HOST}" \
    "https://${PUBLIC_DOMAIN}/api/user/health" >/dev/null
  curl --fail --silent --show-error --max-time 15 \
    --resolve "${PUBLIC_DOMAIN}:443:${HETZNER_PROD_HOST}" \
    "https://${PUBLIC_DOMAIN}/api/settings/health" >/dev/null
  curl --fail --silent --show-error --max-time 15 \
    --resolve "${PUBLIC_DOMAIN}:443:${HETZNER_PROD_HOST}" \
    "https://${PUBLIC_DOMAIN}/api/whatsapp/health" >/dev/null
  curl --fail --silent --show-error --max-time 15 \
    "https://${PUBLIC_DOMAIN}/api/whatsapp/health" >/dev/null
  curl --fail --silent --show-error --max-time 15 \
    "https://${PUBLIC_DOMAIN}/api/intex-agent/health" >/dev/null
  verify_non_404_route "/api/code/internal/logs"
}

verify_deployment_attestation() {
  verify_deployment_document \
    "direct origin" \
    "https://${PUBLIC_DOMAIN}/deployment.json" \
    --resolve "${PUBLIC_DOMAIN}:443:${HETZNER_PROD_HOST}"
  verify_deployment_document \
    "public DNS" \
    "https://${PUBLIC_DOMAIN}/deployment.json"
}

main() {
  trap cleanup EXIT
  require_command curl
  require_command rsync
  require_command ssh
  require_command ssh-keyscan
  require_command git
  require_command node
  require_command tar
  validate_inputs
  resolve_commit_metadata
  prepare_sync_source
  setup_ssh
  resolve_activation_context
  if [[ "${ACTIVATION_MODE}" == "cutover_complete" ]]; then
    verify_remote_release_manifest
    verify_backend_readiness
  else
    sync_repo
    verify_remote_release_manifest
    cleanup_retired_remote_paths
    prepare_runtime_dependencies
    if [[ "${ACTIVATION_MODE}" == "cutover" ]]; then
      run_message_digest_cutover
      verify_backend_readiness
    else
      deploy_runtime
      verify_backend_readiness
      deploy_web_and_edge
    fi
  fi
  verify_code_agent_readiness
  verify_runtime_readiness
  if [[ "${ACTIVATION_MODE}" == "ordinary" ]]; then
    point_current_release
  fi
  publish_deployment_metadata
  verify_deployment_attestation
  DEPLOYMENT_ATTESTATION_VERIFIED="true"

  printf 'Hetzner production deployment completed for %s\n' "${PUBLIC_DOMAIN}"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
