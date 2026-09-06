#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

HETZNER_PROD_HOST="${HETZNER_PROD_HOST:-162.55.210.48}"
REMOTE_USER="${REMOTE_USER:-deploy}"
REMOTE_REPO_DIR="${REMOTE_REPO_DIR:-/opt/intexuraos}"
REMOTE_RELEASE_DIR=""
PUBLIC_DOMAIN="${PUBLIC_DOMAIN:-intexuraos.cloud}"
SSH_PORT="${SSH_PORT:-22}"
DEPLOY_NGINX="${DEPLOY_NGINX:-true}"
SECRET_PACKAGE_VERSION="${SECRET_PACKAGE_VERSION:-}"
KEY_FILE=""
KNOWN_HOSTS_FILE=""
SSH_ARGS=()
SYNC_SOURCE_DIR=""
COMMIT_SHA_VALUE=""
COMMIT_MESSAGE_VALUE=""
WORKFLOW_RUN_ID_VALUE="manual"
RELEASE_MANIFEST_HASH=""

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required"
}

cleanup() {
  local status=$?
  trap - EXIT
  [[ -n "${KEY_FILE}" ]] && rm -f -- "${KEY_FILE}"
  [[ -n "${KNOWN_HOSTS_FILE}" ]] && rm -f -- "${KNOWN_HOSTS_FILE}"
  [[ -n "${SYNC_SOURCE_DIR}" ]] && rm -rf -- "${SYNC_SOURCE_DIR}"
  exit "${status}"
}
trap cleanup EXIT

validate_inputs() {
  [[ -n "${HETZNER_DEPLOY_SSH_PRIVATE_KEY:-}" ]] || fail 'HETZNER_DEPLOY_SSH_PRIVATE_KEY is required'
  [[ "${HETZNER_PROD_HOST}" =~ ^[0-9A-Fa-f:.]+$ ]] || fail 'HETZNER_PROD_HOST must be an IP address'
  [[ "${REMOTE_USER}" =~ ^[a-z_][a-z0-9_-]*$ ]] || fail 'REMOTE_USER is invalid'
  [[ "${REMOTE_REPO_DIR}" == /* && "${REMOTE_REPO_DIR}" != '/' ]] || fail 'REMOTE_REPO_DIR is invalid'
  if [[ ! "${SSH_PORT}" =~ ^[1-9][0-9]{0,4}$ ]] || (( SSH_PORT > 65535 )); then
    fail 'SSH_PORT is invalid'
  fi
  [[ "${SECRET_PACKAGE_VERSION}" =~ ^[1-9][0-9]*$ ]] || fail 'SECRET_PACKAGE_VERSION must be exact'
  case "${DEPLOY_NGINX}" in true|false) ;; *) fail 'DEPLOY_NGINX must be true or false' ;; esac
}

resolve_release() {
  local status=""
  COMMIT_SHA_VALUE="$(git rev-parse HEAD)"
  status="$(git status --porcelain=v1 --untracked-files=all)"
  [[ -z "${status}" ]] || fail 'Deployment checkout is not clean'
  [[ "${COMMIT_SHA_VALUE}" =~ ^[0-9a-f]{40}$ ]] || fail 'Commit SHA is invalid'
  if [[ -n "${GITHUB_SHA:-}" ]]; then
    [[ "${GITHUB_SHA}" == "${COMMIT_SHA_VALUE}" ]] || fail 'Checkout does not match GITHUB_SHA'
  fi
  COMMIT_MESSAGE_VALUE="${GITHUB_COMMIT_MESSAGE:-$(git log -1 --pretty=%s)}"
  [[ -n "${COMMIT_MESSAGE_VALUE}" ]] || fail 'Commit message is empty'
  WORKFLOW_RUN_ID_VALUE="${GITHUB_RUN_ID:-manual}"
  [[ "${WORKFLOW_RUN_ID_VALUE}" == manual || "${WORKFLOW_RUN_ID_VALUE}" =~ ^[0-9]+$ ]] || fail 'Workflow run ID is invalid'
  REMOTE_RELEASE_DIR="${REMOTE_REPO_DIR%/}/releases/${COMMIT_SHA_VALUE}"

  node scripts/hetzner/verify-secret-package-version-pins.mjs \
    "${SECRET_PACKAGE_VERSION}" \
    config/environments/secret-packages.json \
    terraform/hetzner-prod/prod.auto.tfvars.json >/dev/null \
    || fail 'PROD package pins do not match the deployment input'
}

prepare_release_tree() {
  SYNC_SOURCE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/intexuraos-deploy.XXXXXX")"
  git archive "${COMMIT_SHA_VALUE}" | tar -xf - -C "${SYNC_SOURCE_DIR}"
  RELEASE_MANIFEST_HASH="$(node "${SYNC_SOURCE_DIR}/scripts/hetzner/hash-release-tree.mjs" "${SYNC_SOURCE_DIR}")"
  [[ "${RELEASE_MANIFEST_HASH}" =~ ^[0-9a-f]{64}$ ]] || fail 'Release manifest hash is invalid'
}

setup_ssh() {
  KEY_FILE="$(mktemp "${TMPDIR:-/tmp}/intexuraos-ssh-key.XXXXXX")"
  KNOWN_HOSTS_FILE="$(mktemp "${TMPDIR:-/tmp}/intexuraos-known-hosts.XXXXXX")"
  chmod 600 "${KEY_FILE}" "${KNOWN_HOSTS_FILE}"
  printf '%s\n' "${HETZNER_DEPLOY_SSH_PRIVATE_KEY}" | tr -d '\r' > "${KEY_FILE}"
  ssh-keyscan -p "${SSH_PORT}" -H "${HETZNER_PROD_HOST}" > "${KNOWN_HOSTS_FILE}"
  SSH_ARGS=(
    -i "${KEY_FILE}"
    -p "${SSH_PORT}"
    -o BatchMode=yes
    -o ServerAliveInterval=15
    -o ServerAliveCountMax=8
    -o StrictHostKeyChecking=yes
    -o "UserKnownHostsFile=${KNOWN_HOSTS_FILE}"
  )
}

ssh_base() {
  printf 'ssh -i %q -p %q -o BatchMode=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=8 -o StrictHostKeyChecking=yes -o UserKnownHostsFile=%q' \
    "${KEY_FILE}" "${SSH_PORT}" "${KNOWN_HOSTS_FILE}"
}

run_remote_at() {
  local directory="$1"
  local command="$2"
  local quoted_directory=""
  local quoted_command=""
  printf -v quoted_directory '%q' "${directory}"
  printf -v quoted_command '%q' "${command}"
  ssh "${SSH_ARGS[@]}" "${REMOTE_USER}@${HETZNER_PROD_HOST}" \
    "cd ${quoted_directory} && bash -o pipefail -c ${quoted_command}"
}

sync_release() {
  local ssh_command=""
  local quoted_release=""
  printf -v quoted_release '%q' "${REMOTE_RELEASE_DIR}"
  run_remote_at "${REMOTE_REPO_DIR}" "install -d -m 755 ${quoted_release}"
  ssh_command="$(ssh_base)"
  rsync -az --delete --exclude '.git/' -e "${ssh_command}" \
    "${SYNC_SOURCE_DIR%/}/" "${REMOTE_USER}@${HETZNER_PROD_HOST}:${REMOTE_RELEASE_DIR%/}/"

  run_remote_at "${REMOTE_RELEASE_DIR}" \
    "test \"\$(node scripts/hetzner/hash-release-tree.mjs .)\" = '${RELEASE_MANIFEST_HASH}'"
}

deploy_release() {
  local commit_sha_quoted=""
  local commit_message_quoted=""
  local package_version_quoted=""
  local release_dir_quoted=""
  local current_link_quoted=""
  printf -v commit_sha_quoted '%q' "${COMMIT_SHA_VALUE}"
  printf -v commit_message_quoted '%q' "${COMMIT_MESSAGE_VALUE}"
  printf -v package_version_quoted '%q' "${SECRET_PACKAGE_VERSION}"
  printf -v release_dir_quoted '%q' "${REMOTE_RELEASE_DIR}"
  printf -v current_link_quoted '%q' "${REMOTE_REPO_DIR%/}/current"

  run_remote_at "${REMOTE_RELEASE_DIR}" 'corepack enable && CI=true pnpm install --frozen-lockfile'

  # This is intentionally destructive. Any failure after this boundary is fixed forward.
  run_remote_at "${REMOTE_RELEASE_DIR}" \
    "pm2 delete all >/dev/null 2>&1 || true; sudo -n systemctl stop alloy.service >/dev/null 2>&1 || true; ln -sfn ${release_dir_quoted} ${current_link_quoted}"

  run_remote_at "${REMOTE_RELEASE_DIR}" \
    "sudo -n INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/load-secrets.sh --version ${package_version_quoted}"
  run_remote_at "${REMOTE_RELEASE_DIR}" \
    'sudo -n INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/install-pm2-logrotate.sh'
  run_remote_at "${REMOTE_RELEASE_DIR}" \
    'sudo -n INTEXURAOS_ENVIRONMENT=prod bash scripts/observability/install-grafana-alloy.sh'
  run_remote_at "${REMOTE_RELEASE_DIR}" \
    "COMMIT_SHA=${commit_sha_quoted} COMMIT_MESSAGE=${commit_message_quoted} INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/deploy-web.sh"
  run_remote_at "${REMOTE_RELEASE_DIR}" \
    "INTEXURAOS_COMMIT_SHA=${commit_sha_quoted} INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/reload-pm2.sh"
  if [[ "${DEPLOY_NGINX}" == true ]]; then
    run_remote_at "${REMOTE_RELEASE_DIR}" \
      'sudo -n INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/deploy-nginx.sh --message-digests-public'
  fi

  publish_deployment_metadata
  verify_remote_runtime
  delete_obsolete_releases
}

publish_deployment_metadata() {
  local payload=""
  local payload_quoted=""
  local path_quoted=""
  payload="$(node -e 'process.stdout.write(JSON.stringify({commitSha:process.argv[1],commitMessage:process.argv[2],workflowRunId:process.argv[3],secretPackageVersion:process.argv[4],deployedAt:new Date().toISOString()}))' \
    "${COMMIT_SHA_VALUE}" "${COMMIT_MESSAGE_VALUE}" "${WORKFLOW_RUN_ID_VALUE}" "${SECRET_PACKAGE_VERSION}")"
  printf -v payload_quoted '%q' "${payload}"
  printf -v path_quoted '%q' '/var/www/intexuraos/web/current/deployment.json'
  run_remote_at "${REMOTE_RELEASE_DIR}" \
    "tmp=\$(mktemp /var/www/intexuraos/web/current/.deployment.XXXXXX); printf '%s\\n' ${payload_quoted} > \"\${tmp}\"; chmod 644 \"\${tmp}\"; mv -f \"\${tmp}\" ${path_quoted}"
}

verify_remote_runtime() {
  run_remote_at "${REMOTE_RELEASE_DIR}" "node --input-type=module - '${COMMIT_SHA_VALUE}' <<'NODE'
import { execFileSync } from 'node:child_process';
const expected = process.argv[2];
const apps = JSON.parse(execFileSync('pm2', ['jlist'], { encoding: 'utf8' }));
const runtime = apps.filter((app) => app.pm2_env?.namespace !== 'module');
if (runtime.length === 0 || runtime.some((app) => app.pm2_env?.status !== 'online')) process.exit(1);
if (runtime.some((app) => app.pm2_env?.env?.INTEXURAOS_COMMIT_SHA !== expected)) process.exit(1);
NODE
sudo -n systemctl is-active --quiet nginx
sudo -n systemctl is-active --quiet alloy.service
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:12345/-/ready >/dev/null"
}

delete_obsolete_releases() {
  run_remote_at "${REMOTE_RELEASE_DIR}" "node --input-type=module - '${REMOTE_REPO_DIR%/}/releases' '${COMMIT_SHA_VALUE}' '/var/www/intexuraos/web/releases' <<'NODE'
import { lstatSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
const [codeRoot, keep, webRoot] = process.argv.slice(2);
for (const root of [codeRoot, webRoot]) {
  for (const name of readdirSync(root)) {
    if (name === keep) continue;
    if (!/^[0-9a-f]{40}$/u.test(name)) process.exit(1);
    const path = join(root, name);
    const status = lstatSync(path);
    if (!status.isDirectory() || status.isSymbolicLink()) process.exit(1);
    rmSync(path, { recursive: true });
  }
}
NODE"
}

verify_public_runtime() {
  local url=""
  for url in \
    "https://${PUBLIC_DOMAIN}/" \
    "https://${PUBLIC_DOMAIN}/healthz" \
    "https://${PUBLIC_DOMAIN}/api/user/health" \
    "https://${PUBLIC_DOMAIN}/api/code/health"; do
    curl --fail --silent --show-error --max-time 20 \
      --resolve "${PUBLIC_DOMAIN}:443:${HETZNER_PROD_HOST}" "${url}" >/dev/null
  done
  curl --fail --silent --show-error --max-time 20 \
    --resolve "${PUBLIC_DOMAIN}:443:${HETZNER_PROD_HOST}" \
    "https://${PUBLIC_DOMAIN}/deployment.json" \
    | node -e 'let body="";process.stdin.on("data",(c)=>body+=c);process.stdin.on("end",()=>{const d=JSON.parse(body);if(d.commitSha!==process.argv[1]||d.workflowRunId!==process.argv[2]||d.secretPackageVersion!==process.argv[3])process.exit(1)})' \
      "${COMMIT_SHA_VALUE}" "${WORKFLOW_RUN_ID_VALUE}" "${SECRET_PACKAGE_VERSION}"
}

main() {
  validate_inputs
  for command in git node rsync ssh ssh-keyscan tar curl; do require_command "${command}"; done
  resolve_release
  prepare_release_tree
  setup_ssh
  sync_release
  deploy_release
  verify_public_runtime
  printf 'Production deployment complete: %s (package v%s)\n' \
    "${COMMIT_SHA_VALUE}" "${SECRET_PACKAGE_VERSION}"
}

main "$@"
