#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

HETZNER_PROD_HOST="${HETZNER_PROD_HOST:-162.55.210.48}"
REMOTE_USER="${REMOTE_USER:-deploy}"
REMOTE_REPO_DIR="${REMOTE_REPO_DIR:-/opt/intexuraos}"
REMOTE_RELEASES_DIR="${REMOTE_REPO_DIR%/}/releases"
REMOTE_RELEASE_DIR=""
REMOTE_SECRET_CANARY_CONFIG=""
REMOTE_CUTOVER_STATE_PATH="${REMOTE_REPO_DIR%/}/.deployment-state/message-digests/state.json"
TERRAFORM_VERSION="1.5.0"
TERRAFORM_ARCHIVE_SHA256="9ae1bcfef088e9aaabeaf6fdc6cce01187dc4936f1564899ee6fa6baec5ad19c"
TERRAFORM_TOOL_DIR=""
REMOTE_TERRAFORM_TOOLS_DIR="${REMOTE_REPO_DIR%/}/.deployment-tools/terraform/${TERRAFORM_VERSION}"
REMOTE_TERRAFORM_BIN_DIR=""
PUBLIC_DOMAIN="${PUBLIC_DOMAIN:-intexuraos.cloud}"
SSH_PORT="${SSH_PORT:-22}"
DEPLOY_NGINX="${DEPLOY_NGINX:-true}"
SECRET_PACKAGE_VERSION="${SECRET_PACKAGE_VERSION:-}"
SECRET_CANARY_TIMEOUT_SECONDS="${SECRET_CANARY_TIMEOUT_SECONDS:-120}"
WEB_RELEASES_ROOT="${WEB_RELEASES_ROOT:-/var/www/intexuraos/web/releases}"
WEB_CURRENT_LINK="${WEB_CURRENT_LINK:-/var/www/intexuraos/web/current}"
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
STAGED_SECRET_PROJECTION=""
PREVIOUS_SECRET_PROJECTION=""
SECRET_PROJECTION_ACTIVATED="false"
SECRET_PROJECTION_COMPENSATED="false"
CUTOVER_ADMISSION_IRREVERSIBLE="false"
PREVIOUS_WEB_RELEASE=""
WEB_AND_EDGE_MUTATION_STARTED="false"
WEB_AND_EDGE_COMPENSATED="false"
DEPLOYMENT_COMPLETED="false"
RETIRED_REMOTE_PATHS=(
  "packages/infra-otel"
)

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

require_command() {
  local command_name="$1"
  command -v "${command_name}" >/dev/null 2>&1 || fail "${command_name} is required"
}

sha256_file() {
  local path="$1"
  node -e '
const { createHash } = require("node:crypto");
const { createReadStream } = require("node:fs");
const hash = createHash("sha256");
createReadStream(process.argv[1])
  .on("data", (chunk) => hash.update(chunk))
  .on("end", () => process.stdout.write(hash.digest("hex")));
' "${path}"
}

verify_sha256() {
  local path="$1"
  local expected_hash="$2"
  local observed_hash=""

  observed_hash="$(sha256_file "${path}")"
  [[ "${observed_hash}" == "${expected_hash}" ]] \
    || fail "SHA-256 verification failed for $(basename "${path}")"
}

validate_inputs() {
  [[ -n "${HETZNER_DEPLOY_SSH_PRIVATE_KEY:-}" ]] \
    || fail "HETZNER_DEPLOY_SSH_PRIVATE_KEY is required"
  [[ -n "${HETZNER_PROD_HOST}" ]] || fail "HETZNER_PROD_HOST is required"
  [[ -n "${REMOTE_USER}" ]] || fail "REMOTE_USER is required"
  [[ -n "${REMOTE_REPO_DIR}" ]] || fail "REMOTE_REPO_DIR is required"
  [[ "${SSH_PORT}" =~ ^[0-9]+$ ]] || fail "SSH_PORT must be numeric"
  [[ "${SECRET_PACKAGE_VERSION}" =~ ^[1-9][0-9]*$ ]] \
    || fail "SECRET_PACKAGE_VERSION must be an exact positive numeric version"
  [[ "${SECRET_CANARY_TIMEOUT_SECONDS}" =~ ^[1-9][0-9]*$ ]] \
    || fail "SECRET_CANARY_TIMEOUT_SECONDS must be a positive integer"

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
  REMOTE_SECRET_CANARY_CONFIG="${REMOTE_REPO_DIR%/}/.deployment-state/secret-canary-${COMMIT_SHA_VALUE}.json"
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
  printf 'ssh -i %q -p %q -o BatchMode=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=8 -o StrictHostKeyChecking=yes -o UserKnownHostsFile=%q' \
    "${KEY_FILE}" \
    "${SSH_PORT}" \
    "${KNOWN_HOSTS_FILE}"
}

prepare_remote_terraform() {
  local archive_path=""
  local terraform_binary=""
  local terraform_url=""
  local binary_hash=""
  local ssh_command=""
  local remote_dir_quoted=""
  local remote_candidate_path=""
  local remote_candidate_quoted=""
  local remote_binary_path=""
  local remote_binary_quoted=""
  local binary_hash_quoted=""
  local version_quoted=""

  TERRAFORM_TOOL_DIR="$(mktemp -d "${TMPDIR:-/tmp}/intexuraos-terraform.XXXXXX")"
  archive_path="${TERRAFORM_TOOL_DIR}/terraform.zip"
  terraform_binary="${TERRAFORM_TOOL_DIR}/terraform"
  terraform_url="https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/terraform_${TERRAFORM_VERSION}_linux_amd64.zip"

  curl \
    --fail \
    --silent \
    --show-error \
    --location \
    --proto '=https' \
    --tlsv1.2 \
    --output "${archive_path}" \
    "${terraform_url}"
  verify_sha256 "${archive_path}" "${TERRAFORM_ARCHIVE_SHA256}"
  unzip -q "${archive_path}" -d "${TERRAFORM_TOOL_DIR}"
  [[ -f "${terraform_binary}" ]] || fail "Terraform archive did not contain the expected binary"
  chmod 755 "${terraform_binary}"

  PATH="${TERRAFORM_TOOL_DIR}:${PATH}" terraform version -json \
    | node -e '
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const value = JSON.parse(input);
  if (value.terraform_version !== process.argv[1] || value.platform !== "linux_amd64") {
    process.exit(1);
  }
});
' "${TERRAFORM_VERSION}" \
    || fail "Downloaded Terraform runtime has an unexpected version or platform"

  binary_hash="$(sha256_file "${terraform_binary}")"
  [[ "${binary_hash}" =~ ^[0-9a-f]{64}$ ]] || fail "Could not hash the Terraform binary"
  remote_candidate_path="${REMOTE_TERRAFORM_TOOLS_DIR}/.terraform.${WORKFLOW_RUN_ID_VALUE}.candidate"
  remote_binary_path="${REMOTE_TERRAFORM_TOOLS_DIR}/terraform"
  printf -v remote_dir_quoted '%q' "${REMOTE_TERRAFORM_TOOLS_DIR}"
  printf -v remote_candidate_quoted '%q' "${remote_candidate_path}"
  printf -v remote_binary_quoted '%q' "${remote_binary_path}"
  printf -v binary_hash_quoted '%q' "${binary_hash}"
  printf -v version_quoted '%q' "${TERRAFORM_VERSION}"

  run_remote_at "${REMOTE_REPO_DIR}" "install -d -m 755 ${remote_dir_quoted}"
  ssh_command="$(ssh_command_string)"
  rsync -a \
    -e "${ssh_command}" \
    "${terraform_binary}" \
    "${REMOTE_USER}@${HETZNER_PROD_HOST}:${remote_candidate_path}"
  run_remote_at "${REMOTE_REPO_DIR}" \
    "observed_hash=\$(node -e 'const { createHash } = require(\"node:crypto\"); const { createReadStream } = require(\"node:fs\"); const hash = createHash(\"sha256\"); createReadStream(process.argv[1]).on(\"data\", (chunk) => hash.update(chunk)).on(\"end\", () => process.stdout.write(hash.digest(\"hex\")));' ${remote_candidate_quoted}); if [[ \"\${observed_hash}\" != ${binary_hash_quoted} ]]; then rm -f -- ${remote_candidate_quoted}; exit 1; fi; chmod 755 ${remote_candidate_quoted}; mv -f -- ${remote_candidate_quoted} ${remote_binary_quoted}"
  run_remote_at "${REMOTE_REPO_DIR}" \
    "PATH=${remote_dir_quoted}:\$PATH terraform version -json | node -e 'let input = \"\"; process.stdin.setEncoding(\"utf8\"); process.stdin.on(\"data\", (chunk) => { input += chunk; }); process.stdin.on(\"end\", () => { const value = JSON.parse(input); if (value.terraform_version !== process.argv[1] || value.platform !== \"linux_amd64\") process.exit(1); });' ${version_quoted}"

  REMOTE_TERRAFORM_BIN_DIR="${REMOTE_TERRAFORM_TOOLS_DIR}"
}

run_remote_at() {
  local directory="$1"
  local command="$2"
  local quoted_directory=""

  printf -v quoted_directory '%q' "${directory}"
  ssh -i "${KEY_FILE}" \
    -p "${SSH_PORT}" \
    -o BatchMode=yes \
    -o ServerAliveInterval=15 \
    -o ServerAliveCountMax=8 \
    -o StrictHostKeyChecking=yes \
    -o UserKnownHostsFile="${KNOWN_HOSTS_FILE}" \
    "${REMOTE_USER}@${HETZNER_PROD_HOST}" \
    "cd ${quoted_directory} && ${command}"
}

run_remote() {
  local command="$1"
  local quoted_command=""

  [[ -n "${REMOTE_RELEASE_DIR}" ]] || fail "Remote release directory is unresolved"
  printf -v quoted_command '%q' "${command}"
  run_remote_at "${REMOTE_RELEASE_DIR}" "bash -o pipefail -c ${quoted_command}"
}

prepare_remote_web_layout() {
  # Identity expansion must happen on the remote host.
  # shellcheck disable=SC2016
  run_remote_at "${REMOTE_REPO_DIR}" \
    'web_owner="$(id -un)"; web_group="$(id -gn)"; sudo -n install -d -o "${web_owner}" -g "${web_group}" -m 755 -- /var/www/intexuraos/web /var/www/intexuraos/web/releases; test -w /var/www/intexuraos/web; test -w /var/www/intexuraos/web/releases'
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
    "install -d -m 755 ${releases_dir_quoted} ${previous_dir_quoted}; rsync -a --delete --exclude '/releases/' --exclude '/.deployment-state/' --exclude '/.deployment-tools/' ${repo_dir_quoted} ${previous_dir_quoted}/; test -f ${previous_dir_quoted}/ecosystem.config.prod.cjs"
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
  local candidate_deployment_path="${WEB_RELEASES_ROOT%/}/${COMMIT_SHA_VALUE}/deployment.json"

  [[ "${COMMIT_SHA_VALUE}" =~ ^[0-9a-f]{40}$ ]] \
    || fail 'Candidate deployment metadata path requires an exact commit SHA'
  printf -v deployment_path_quoted '%q' "${candidate_deployment_path}"
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
  local secret_package_version_quoted=""
  local commit_sha_quoted=""
  local staged_output=""
  local staged_projection_quoted=""
  printf -v secret_package_version_quoted '%q' "${SECRET_PACKAGE_VERSION}"
  printf -v commit_sha_quoted '%q' "${COMMIT_SHA_VALUE}"
  run_remote 'CI=true pnpm install --frozen-lockfile'
  staged_output="$(run_remote \
    "sudo -n INTEXURAOS_COMMIT_SHA=${commit_sha_quoted} INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/load-secrets.sh --version ${secret_package_version_quoted} --stage-only")"
  PREVIOUS_SECRET_PROJECTION="$(printf '%s\n' "${staged_output}" \
    | sed -n 's/^PREVIOUS_PROJECTION_RELEASE_NAME=//p')"
  [[ "${PREVIOUS_SECRET_PROJECTION}" =~ ^(legacy-pre-packages|prod-v[1-9][0-9]*-[0-9a-f]{8}-[0-9a-f]{40})$ ]] \
    || fail 'Remote previous secret projection name is invalid'
  STAGED_SECRET_PROJECTION="$(printf '%s\n' "${staged_output}" \
    | sed -n 's/^STAGED_PROJECTION_RELEASE_NAME=//p')"
  [[ "${STAGED_SECRET_PROJECTION}" =~ ^prod-v[1-9][0-9]*-[0-9a-f]{8}-${COMMIT_SHA_VALUE}$ ]] \
    || fail 'Remote staged secret projection name is invalid'
  printf -v staged_projection_quoted '%q' "${STAGED_SECRET_PROJECTION}"
  run_remote \
    "sudo -n INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/load-secrets.sh --preflight ${staged_projection_quoted}"
  run_remote 'sudo -n INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/install-pm2-logrotate.sh'
}

activate_secret_projection() {
  local staged_projection_quoted=""
  [[ -n "${STAGED_SECRET_PROJECTION}" ]] || fail 'Staged secret projection is unresolved'
  printf -v staged_projection_quoted '%q' "${STAGED_SECRET_PROJECTION}"
  run_remote \
    "sudo -n INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/load-secrets.sh --activate ${staged_projection_quoted}"
  SECRET_PROJECTION_ACTIVATED="true"
}

reload_alloy_for_active_projection() {
  run_remote \
    'sudo -n INTEXURAOS_ENVIRONMENT=prod bash scripts/observability/install-grafana-alloy.sh'
}

run_secret_projection_canary() {
  local commit_sha_quoted=""
  local canary_config_quoted=""
  local canary_config_dir_quoted=""
  printf -v commit_sha_quoted '%q' "${COMMIT_SHA_VALUE}"
  printf -v canary_config_quoted '%q' "${REMOTE_SECRET_CANARY_CONFIG}"
  printf -v canary_config_dir_quoted '%q' "$(dirname "${REMOTE_SECRET_CANARY_CONFIG}")"
  run_remote \
    "install -d -m 700 ${canary_config_dir_quoted}; INTEXURAOS_COMMIT_SHA=${commit_sha_quoted} INTEXURAOS_ENVIRONMENT=prod node -e 'const { chmodSync, writeFileSync } = require(\"node:fs\"); const { resolve } = require(\"node:path\"); const config = require(resolve(process.argv[1])); if (!config || !Array.isArray(config.apps)) process.exit(1); writeFileSync(process.argv[2], JSON.stringify(config), { encoding: \"utf8\", mode: 0o600 }); chmodSync(process.argv[2], 0o600);' ecosystem.config.prod.cjs ${canary_config_quoted}; pm2 start ${canary_config_quoted} --only code-agent --update-env"
  wait_for_code_agent_canary
}

cleanup_remote_secret_canary_config() {
  local canary_config_quoted=""
  [[ -n "${REMOTE_SECRET_CANARY_CONFIG}" ]] || return 0
  printf -v canary_config_quoted '%q' "${REMOTE_SECRET_CANARY_CONFIG}"
  run_remote "rm -f -- ${canary_config_quoted}"
}

reload_alloy_for_previous_projection() {
  run_remote_at "${PREVIOUS_RELEASE_DIR}" \
    'sudo -n INTEXURAOS_ENVIRONMENT=prod bash scripts/observability/install-grafana-alloy.sh'
}

reload_previous_runtime() {
  local current_link_quoted=""
  local previous_dir_quoted=""
  local previous_sha_quoted=""
  printf -v current_link_quoted '%q' "${REMOTE_REPO_DIR%/}/current"
  printf -v previous_dir_quoted '%q' "${PREVIOUS_RELEASE_DIR}"
  printf -v previous_sha_quoted '%q' "${PREVIOUS_RELEASE_SHA}"
  run_remote_at "${PREVIOUS_RELEASE_DIR}" \
    "INTEXURAOS_COMMIT_SHA=${previous_sha_quoted} INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/reload-pm2.sh" \
    || return 1
  run_remote_at "${REMOTE_REPO_DIR}" \
    "ln -sfn ${previous_dir_quoted} ${current_link_quoted}"
}

restore_previous_web_and_edge() {
  local previous_web_quoted=""
  local current_web_quoted=""
  [[ "${WEB_AND_EDGE_MUTATION_STARTED}" == "true" ]] || return 0
  [[ "${WEB_AND_EDGE_COMPENSATED}" != "true" ]] || return 0
  [[ "${PREVIOUS_WEB_RELEASE}" == "${WEB_RELEASES_ROOT%/}/${PREVIOUS_RELEASE_SHA}" ]] \
    || return 1
  printf -v previous_web_quoted '%q' "${PREVIOUS_WEB_RELEASE}"
  printf -v current_web_quoted '%q' "${WEB_CURRENT_LINK}"
  run_remote \
    "test -d ${previous_web_quoted} && test -f ${previous_web_quoted}/index.html; next_link=\$(mktemp ${current_web_quoted}.rollback.XXXXXX); rm -f -- \"\${next_link}\"; trap 'rm -f -- \"\${next_link}\"' EXIT; ln -s ${previous_web_quoted} \"\${next_link}\"; mv -Tf \"\${next_link}\" ${current_web_quoted}; trap - EXIT" \
    || return 1
  if [[ "${DEPLOY_NGINX}" == "true" ]]; then
    run_remote_at "${PREVIOUS_RELEASE_DIR}" \
      'sudo -n INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/deploy-nginx.sh --message-digests-public' \
      || return 1
  fi
  WEB_AND_EDGE_COMPENSATED="true"
}

compensate_secret_projection() {
  local previous_projection_quoted=""
  local compensation_failed=0
  [[ "${SECRET_PROJECTION_ACTIVATED}" == "true" ]] || return 0
  [[ "${SECRET_PROJECTION_COMPENSATED}" != "true" ]] || return 0
  [[ -n "${PREVIOUS_SECRET_PROJECTION}" ]] || return 1
  printf -v previous_projection_quoted '%q' "${PREVIOUS_SECRET_PROJECTION}"
  printf 'Compensating failed deployment with prior production release\n' >&2
  if run_remote \
    "sudo -n INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/load-secrets.sh --rollback ${previous_projection_quoted}"
  then
    reload_alloy_for_previous_projection || compensation_failed=1
  else
    compensation_failed=1
  fi
  reload_previous_runtime || compensation_failed=1
  restore_previous_web_and_edge || compensation_failed=1
  verify_backend_readiness || compensation_failed=1
  verify_runtime_readiness || compensation_failed=1
  cleanup_remote_secret_canary_config || compensation_failed=1
  if [[ "${compensation_failed}" -eq 0 ]]; then
    SECRET_PROJECTION_COMPENSATED="true"
  fi
  return "${compensation_failed}"
}

cleanup() {
  local exit_status=$?

  set +e
  if [[ "${SECRET_PROJECTION_ACTIVATED}" == "true" &&
    "${DEPLOYMENT_COMPLETED}" != "true" &&
    "${CUTOVER_ADMISSION_IRREVERSIBLE}" != "true"
  ]]; then
    if ! compensate_secret_projection; then
      printf 'ERROR: Could not restore the prior secret projection, runtime, Web, and edge\n' >&2
    fi
  elif [[ "${CUTOVER_ADMISSION_IRREVERSIBLE}" == "true" && "${DEPLOYMENT_COMPLETED}" != "true" ]]; then
    printf 'Irreversible Message Digest admission recorded; external release compensation is disabled\n' >&2
  fi
  if [[ "${DEPLOYMENT_METADATA_PUBLISHED}" == "true" && "${DEPLOYMENT_ATTESTATION_VERIFIED}" != "true" ]]; then
    if ! withdraw_deployment_metadata; then
      printf 'ERROR: Could not withdraw unverified deployment attestation\n' >&2
    fi
  fi
  if [[ -n "${KEY_FILE}" && -n "${REMOTE_RELEASE_DIR}" && -n "${REMOTE_SECRET_CANARY_CONFIG}" ]]; then
    cleanup_remote_secret_canary_config >/dev/null 2>&1 || true
  fi
  [[ -n "${KEY_FILE}" ]] && rm -f "${KEY_FILE}"
  [[ -n "${KNOWN_HOSTS_FILE}" ]] && rm -f "${KNOWN_HOSTS_FILE}"
  [[ -n "${DEPLOYMENT_RESPONSE_HEADERS_FILE}" ]] && rm -f "${DEPLOYMENT_RESPONSE_HEADERS_FILE}"
  [[ -n "${CODE_HEALTH_RESPONSE_HEADERS_FILE}" ]] && rm -f "${CODE_HEALTH_RESPONSE_HEADERS_FILE}"
  [[ -n "${CODE_HEALTH_RESPONSE_BODY_FILE}" ]] && rm -f "${CODE_HEALTH_RESPONSE_BODY_FILE}"
  [[ -n "${RELEASE_ATTESTATION_FILE}" ]] && rm -f "${RELEASE_ATTESTATION_FILE}"
  if [[ -n "${TERRAFORM_TOOL_DIR}" && -d "${TERRAFORM_TOOL_DIR}" ]]; then
    rm -rf -- "${TERRAFORM_TOOL_DIR}"
  fi
  if [[ -n "${SYNC_SOURCE_DIR}" && -d "${SYNC_SOURCE_DIR}" ]]; then
    rm -rf -- "${SYNC_SOURCE_DIR}"
  fi
  return "${exit_status}"
}

deploy_runtime() {
  local commit_sha_quoted=""
  printf -v commit_sha_quoted '%q' "${COMMIT_SHA_VALUE}"
  run_remote "INTEXURAOS_COMMIT_SHA=${commit_sha_quoted} INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/reload-pm2.sh"
}

run_message_digest_cutover() {
  local cutover_start=""
  local cutover_exit_status=0
  local admission_state_status=0
  local durable_status=""
  local remote_terraform_bin_dir_quoted=""
  local release_dir_quoted=""
  local previous_dir_quoted=""
  local previous_sha_quoted=""
  local merge_sha_quoted=""
  local tested_tree_quoted=""
  local deployment_id_quoted=""
  local manifest_hash_quoted=""
  local cutover_start_quoted=""
  [[ -n "${REMOTE_TERRAFORM_BIN_DIR}" ]] || fail "Remote Terraform runtime is unresolved"
  cutover_start="$(date -u +'%Y-%m-%dT%H:%M:%S.000Z')"
  printf -v remote_terraform_bin_dir_quoted '%q' "${REMOTE_TERRAFORM_BIN_DIR}"
  printf -v release_dir_quoted '%q' "${REMOTE_RELEASE_DIR}"
  printf -v previous_dir_quoted '%q' "${PREVIOUS_RELEASE_DIR}"
  printf -v previous_sha_quoted '%q' "${PREVIOUS_RELEASE_SHA}"
  printf -v merge_sha_quoted '%q' "${COMMIT_SHA_VALUE}"
  printf -v tested_tree_quoted '%q' "${TESTED_TREE_VALUE}"
  printf -v deployment_id_quoted '%q' "${WORKFLOW_RUN_ID_VALUE}"
  printf -v manifest_hash_quoted '%q' "${RELEASE_MANIFEST_HASH}"
  printf -v cutover_start_quoted '%q' "${cutover_start}"
  if run_remote \
    "PATH=${remote_terraform_bin_dir_quoted}:\$PATH RELEASE_DIR=${release_dir_quoted} PREVIOUS_RELEASE_DIR=${previous_dir_quoted} PREVIOUS_RELEASE_SHA=${previous_sha_quoted} MERGE_SHA=${merge_sha_quoted} TESTED_TREE=${tested_tree_quoted} DEPLOYMENT_ID=${deployment_id_quoted} RELEASE_MANIFEST_HASH=${manifest_hash_quoted} CUTOVER_START=${cutover_start_quoted} bash scripts/hetzner/cutover-message-digests.sh"
  then
    cutover_exit_status=0
  else
    cutover_exit_status=$?
  fi

  if durable_status="$(read_remote_cutover_status)"; then
    case "${durable_status}" in
      admitting|admitted|complete)
        CUTOVER_ADMISSION_IRREVERSIBLE="true"
        ;;
      absent|in_progress|compensating|compensated)
        CUTOVER_ADMISSION_IRREVERSIBLE="false"
        ;;
      *)
        CUTOVER_ADMISSION_IRREVERSIBLE="true"
        admission_state_status=1
        ;;
    esac
  else
    admission_state_status=$?
    CUTOVER_ADMISSION_IRREVERSIBLE="true"
  fi

  if [[ "${cutover_exit_status}" -ne 0 ]]; then
    return "${cutover_exit_status}"
  fi
  return "${admission_state_status}"
}

point_current_release() {
  local current_link_quoted=""
  local release_dir_quoted=""
  printf -v current_link_quoted '%q' "${REMOTE_REPO_DIR%/}/current"
  printf -v release_dir_quoted '%q' "${REMOTE_RELEASE_DIR}"
  run_remote_at "${REMOTE_REPO_DIR}" "ln -sfn ${release_dir_quoted} ${current_link_quoted}"
}

snapshot_previous_web_release() {
  local previous_web_quoted=""
  local current_web_quoted=""
  PREVIOUS_WEB_RELEASE="${WEB_RELEASES_ROOT%/}/${PREVIOUS_RELEASE_SHA}"
  printf -v previous_web_quoted '%q' "${PREVIOUS_WEB_RELEASE}"
  printf -v current_web_quoted '%q' "${WEB_CURRENT_LINK}"
  run_remote \
    "test -L ${current_web_quoted}; observed_web=\$(readlink -f ${current_web_quoted}); [[ \"\${observed_web}\" == ${previous_web_quoted} ]]; test -f ${previous_web_quoted}/index.html"
}

deploy_web_and_edge() {
  snapshot_previous_web_release
  WEB_AND_EDGE_MUTATION_STARTED="true"
  run_remote_deploy_web

  if [[ "${DEPLOY_NGINX}" == "true" ]]; then
    run_remote 'sudo -n INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/deploy-nginx.sh'
  fi
}

verify_active_secret_projection_version() {
  local active_version=""
  local remote_verify_command=""
  IFS= read -r -d '' remote_verify_command <<'REMOTE_COMMAND' || true
node --input-type=module <<'NODE'
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
const root = '/var/lib/intexuraos/secret-projections/prod';
const current = `${root}/current`;
const status = lstatSync(current);
if (!status.isSymbolicLink()) process.exit(1);
const release = readlinkSync(current);
const match = /^prod-v([1-9][0-9]*)-[0-9a-f]{8}-[0-9a-f]{40}$/.exec(release);
if (match === null) process.exit(1);
const metadata = JSON.parse(readFileSync(`${current}/metadata.json`, 'utf8'));
if (
  metadata?.schemaVersion !== 1 ||
  metadata.environment !== 'prod' ||
  metadata.secretId !== 'INTEXURAOS_SECRET_PACKAGE_PROD' ||
  typeof metadata.version !== 'string' ||
  !/^[1-9][0-9]*$/.test(metadata.version) ||
  metadata.version !== match[1]
) process.exit(1);
process.stdout.write(metadata.version);
NODE
REMOTE_COMMAND
  active_version="$(run_remote "${remote_verify_command}")" \
    || fail 'Unable to verify active PROD secret package metadata'
  [[ "${active_version}" =~ ^[1-9][0-9]*$ ]] \
    || fail 'Active PROD secret package metadata returned an invalid version'
  [[ "${active_version}" == "${SECRET_PACKAGE_VERSION}" ]] \
    || fail 'The active PROD secret package version does not match SECRET_PACKAGE_VERSION'
}

clear_code_agent_health_files() {
  [[ -n "${CODE_HEALTH_RESPONSE_HEADERS_FILE}" ]] && rm -f "${CODE_HEALTH_RESPONSE_HEADERS_FILE}"
  [[ -n "${CODE_HEALTH_RESPONSE_BODY_FILE}" ]] && rm -f "${CODE_HEALTH_RESPONSE_BODY_FILE}"
  CODE_HEALTH_RESPONSE_HEADERS_FILE=""
  CODE_HEALTH_RESPONSE_BODY_FILE=""
}

probe_code_agent_health() {
  local label="$1"
  local url="$2"
  local status=""
  shift 2

  CODE_HEALTH_RESPONSE_HEADERS_FILE="$(mktemp "${TMPDIR:-/tmp}/intexuraos-code-health-headers.XXXXXX")"
  CODE_HEALTH_RESPONSE_BODY_FILE="$(mktemp "${TMPDIR:-/tmp}/intexuraos-code-health-body.XXXXXX")"
  if ! status="$(curl --silent --show-error --max-time 15 \
      --dump-header "${CODE_HEALTH_RESPONSE_HEADERS_FILE}" \
      --output "${CODE_HEALTH_RESPONSE_BODY_FILE}" \
      --write-out '%{http_code}' \
      "$@" "${url}")"; then
    clear_code_agent_health_files
    return 1
  fi

  if ! node scripts/hetzner/verify-code-agent-health.mjs \
    "${status}" "${CODE_HEALTH_RESPONSE_HEADERS_FILE}" < "${CODE_HEALTH_RESPONSE_BODY_FILE}"; then
    clear_code_agent_health_files
    return 1
  fi

  clear_code_agent_health_files
}

verify_code_agent_health() {
  local label="$1"
  local url="$2"
  shift 2
  if ! probe_code_agent_health "${label}" "${url}" "$@"; then
    fail "Code-agent semantic health contract failed through ${label}"
  fi
}

wait_for_code_agent_canary() {
  local deadline=$((SECONDS + SECRET_CANARY_TIMEOUT_SECONDS))
  while ((SECONDS < deadline)); do
    if probe_code_agent_health \
      "candidate direct origin" \
      "https://${PUBLIC_DOMAIN}/api/code/health" \
      --resolve "${PUBLIC_DOMAIN}:443:${HETZNER_PROD_HOST}"; then
      return 0
    fi
    sleep 5
  done
  fail 'Candidate code-agent did not pass semantic health with Firestore'
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

verify_semantic_health() {
  local label="$1"
  local url="$2"
  local expected_service="$3"
  local required_check="$4"
  shift 4

  if ! curl --fail --silent --show-error --max-time 15 \
    "$@" "${url}" \
    | node scripts/hetzner/verify-semantic-health.mjs "${expected_service}" "${required_check}"; then
    fail "Semantic health contract failed through ${label}"
  fi
}

verify_backend_readiness() {
  run_remote 'INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/verify-matrix-corpus-runtime.sh'
  verify_semantic_health \
    "direct-origin WhatsApp" \
    "https://${PUBLIC_DOMAIN}/api/whatsapp/health" \
    "whatsapp-service" \
    "firestore" \
    --resolve "${PUBLIC_DOMAIN}:443:${HETZNER_PROD_HOST}"
  verify_semantic_health \
    "direct-origin Intex Agent" \
    "https://${PUBLIC_DOMAIN}/api/intex-agent/health" \
    "intex-agent" \
    "firestore" \
    --resolve "${PUBLIC_DOMAIN}:443:${HETZNER_PROD_HOST}"
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
    '{"commitSha":"%s","workflowRunId":"%s","deployedAt":"%s","secretPackageVersion":"%s"}' \
    "${COMMIT_SHA_VALUE}" \
    "${WORKFLOW_RUN_ID_VALUE}" \
    "${deployed_at}" \
    "${SECRET_PACKAGE_VERSION}"
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
    "${SECRET_PACKAGE_VERSION}" \
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
  verify_semantic_health \
    "direct-origin WhatsApp" \
    "https://${PUBLIC_DOMAIN}/api/whatsapp/health" \
    "whatsapp-service" \
    "firestore" \
    --resolve "${PUBLIC_DOMAIN}:443:${HETZNER_PROD_HOST}"
  verify_semantic_health \
    "public-DNS WhatsApp" \
    "https://${PUBLIC_DOMAIN}/api/whatsapp/health" \
    "whatsapp-service" \
    "firestore"
  verify_semantic_health \
    "public-DNS Intex Agent" \
    "https://${PUBLIC_DOMAIN}/api/intex-agent/health" \
    "intex-agent" \
    "firestore"
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
  require_command unzip
  validate_inputs
  resolve_commit_metadata
  prepare_sync_source
  setup_ssh
  resolve_activation_context
  if [[ "${ACTIVATION_MODE}" == "cutover" ]]; then
    prepare_remote_terraform
  fi
  if [[ "${ACTIVATION_MODE}" == "cutover_complete" ]]; then
    verify_remote_release_manifest
    verify_active_secret_projection_version
    verify_backend_readiness
  else
    sync_repo
    verify_remote_release_manifest
    cleanup_retired_remote_paths
    prepare_remote_web_layout
    prepare_runtime_dependencies
    activate_secret_projection
    reload_alloy_for_active_projection
    run_secret_projection_canary
    if [[ "${ACTIVATION_MODE}" == "cutover" ]]; then
      run_message_digest_cutover
      verify_backend_readiness
    else
      deploy_runtime
      verify_backend_readiness
      deploy_web_and_edge
    fi
    cleanup_remote_secret_canary_config
  fi
  verify_code_agent_readiness
  verify_runtime_readiness
  if [[ "${ACTIVATION_MODE}" == "ordinary" ]]; then
    point_current_release
  fi
  publish_deployment_metadata
  verify_deployment_attestation
  DEPLOYMENT_ATTESTATION_VERIFIED="true"
  DEPLOYMENT_COMPLETED="true"

  printf 'Hetzner production deployment completed for %s\n' "${PUBLIC_DOMAIN}"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
