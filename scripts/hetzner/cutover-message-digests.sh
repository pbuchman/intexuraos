#!/usr/bin/env bash

set -Eeuo pipefail
IFS=$'\n\t'

RELEASE_DIR="${RELEASE_DIR:-$(pwd)}"
PREVIOUS_RELEASE_DIR="${PREVIOUS_RELEASE_DIR:-}"
PREVIOUS_RELEASE_SHA="${PREVIOUS_RELEASE_SHA:-}"
MERGE_SHA="${MERGE_SHA:-}"
TESTED_TREE="${TESTED_TREE:-}"
DEPLOYMENT_ID="${DEPLOYMENT_ID:-}"
RELEASE_MANIFEST_HASH="${RELEASE_MANIFEST_HASH:-}"
CUTOVER_START="${CUTOVER_START:-}"
ENV_FILE="${ENV_FILE:-/etc/intexuraos/.env.prod}"
STATE_DIR="${CUTOVER_STATE_DIR:-/opt/intexuraos/.deployment-state/message-digests}"
STATE_PATH="${STATE_DIR}/state.json"
CURRENT_RELEASE_LINK="${CURRENT_RELEASE_LINK:-/opt/intexuraos/current}"
LEGACY_WEB_ROOT="${LEGACY_WEB_ROOT:-/var/www/intexuraos/web/dist}"
WEB_RELEASES_ROOT="${WEB_RELEASES_ROOT:-/var/www/intexuraos/web/releases}"
WEB_CURRENT_LINK="${WEB_CURRENT_LINK:-/var/www/intexuraos/web/current}"
PROJECT_ID="${PROJECT_ID:-intexuraos-dev-pbuchman}"
TERRAFORM_GITHUB_OWNER="${TERRAFORM_GITHUB_OWNER:-pbuchman}"
TERRAFORM_GITHUB_CONNECTION_NAME="${TERRAFORM_GITHUB_CONNECTION_NAME:-pbuchman-github}"
STATE_HELPER="${RELEASE_DIR}/scripts/hetzner/message-digest-cutover-state.mjs"
SUPPORT_HELPER="${RELEASE_DIR}/scripts/hetzner/message-digest-cutover-support.mjs"
TEMPLATE_VERIFIER="${RELEASE_DIR}/scripts/hetzner/verify-whatsapp-message-digest-template.mjs"
BINDING_FILE=""
ATTEMPT_DIR=""
DRY_RUN_REPORT=""
APPLY_REPORT=""
VERIFY_REPORT=""
ACTIVATE_REPORT=""
ACTIVE_VERIFY_REPORT=""
POST_ADMISSION_VERIFY_REPORT=""
STAGED_CANDIDATE_VERIFY_REPORT=""
ACTIVE_CANDIDATE_VERIFY_REPORT=""
CANDIDATE_CONFIG=""
CANDIDATE_WEB_ROOT=""
WEB_RELEASE_DIR=""
TERRAFORM_DATA_ROOT=""
TERRAFORM_PLAN_ROOT=""
RUNTIME_SWITCH_MARKER=""
CUTOVER_ADMITTED="false"
ROLLBACK_RUNNING="false"
CUTOVER_ATTEMPT=""
CUTOVER_DEADLINE=""
CUTOVER_STATUS=""

DEV_TERRAFORM_TARGETS=(
  '-target=google_pubsub_topic.message_digest_runs'
  '-target=google_pubsub_topic_iam_member.message_digest_publishes_runs'
  '-target=google_pubsub_topic_iam_member.message_digest_publishes_whatsapp'
)
PROD_TERRAFORM_TARGETS=(
  '-target=google_pubsub_topic.hetzner_push_dlq["message_digest_runs"]'
  '-target=google_pubsub_subscription.hetzner_push_dlq_inspect["message_digest_runs"]'
  '-target=google_pubsub_topic_iam_member.hetzner_push_dlq_publisher["message_digest_runs"]'
  '-target=google_pubsub_subscription.hetzner_push["message_digest_runs"]'
  '-target=google_pubsub_subscription_iam_member.hetzner_push_dlq_subscriber["message_digest_runs"]'
  '-target=google_cloud_scheduler_job.hetzner_http["message_digest_tick"]'
  '-target=google_cloud_scheduler_job.hetzner_http["mobile_notifications_digest_yesterday"]'
)

STEP_NAMES=(
  "verify-tested-release"
  "assert-pending-migration-128"
  "start-candidate-stack"
  "migration-dry-run"
  "estimate-window"
  "terraform-dev-forward"
  "migration-128"
  "wait-index-readiness"
  "terraform-prod-forward"
  "terraform-inverse-proof"
  "migration-apply"
  "migration-verify"
  "candidate-zero-send-proof"
  "switch-runtime-under-hold"
  "migration-activate"
  "public-admission"
  "post-admission-verify"
)

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  return 1
}

now_iso() {
  date -u +'%Y-%m-%dT%H:%M:%S.000Z'
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required"
}

validate_inputs() {
  [[ "${MERGE_SHA}" =~ ^[0-9a-f]{40}$ ]] || fail "MERGE_SHA must be a full lowercase SHA"
  [[ "${TESTED_TREE}" =~ ^[0-9a-f]{40}$ ]] || fail "TESTED_TREE must be a full lowercase tree"
  [[ "${RELEASE_MANIFEST_HASH}" =~ ^[0-9a-f]{64}$ ]] \
    || fail "RELEASE_MANIFEST_HASH must be a SHA-256 digest"
  [[ "${DEPLOYMENT_ID}" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$ ]] \
    || fail "DEPLOYMENT_ID is invalid"
  [[ "${PREVIOUS_RELEASE_SHA}" =~ ^[0-9a-f]{40}$ ]] \
    || fail "PREVIOUS_RELEASE_SHA must be a full lowercase SHA"
  [[ -d "${RELEASE_DIR}" ]] || fail "Release directory is missing"
  [[ -d "${PREVIOUS_RELEASE_DIR}" ]] || fail "The previous immutable release is missing"
  [[ -r "${ENV_FILE}" ]] || fail "Production env file is missing"
  [[ -r "${STATE_HELPER}" && -r "${SUPPORT_HELPER}" && -r "${TEMPLATE_VERIFIER}" ]] \
    || fail "Cutover helpers are missing"
  if [[ -z "${CUTOVER_START}" ]]; then
    CUTOVER_START="$(now_iso)"
  fi
}

load_runtime_environment() {
  local parsed_env_file=""
  local env_name=""
  local env_value=""

  parsed_env_file="$(mktemp "${TMPDIR:-/tmp}/message-digest-runtime-env.XXXXXX")"
  chmod 600 "${parsed_env_file}"
  if ! node - "${ENV_FILE}" "${RELEASE_DIR}" > "${parsed_env_file}" <<'NODE'
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const { resolve } = require('node:path');

try {
  const [envPath, releaseDir] = process.argv.slice(2);
  const requireFromRelease = createRequire(resolve(releaseDir, 'package.json'));
  const { parse } = requireFromRelease('dotenv');
  const environment = parse(readFileSync(envPath, 'utf8'));
  for (const [name, value] of Object.entries(environment)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name) || value.includes('\0')) {
      throw new Error('invalid runtime environment entry');
    }
    process.stdout.write(name);
    process.stdout.write('\0');
    process.stdout.write(value);
    process.stdout.write('\0');
  }
} catch {
  process.stderr.write('Unable to parse the production runtime environment\n');
  process.exitCode = 1;
}
NODE
  then
    rm -f "${parsed_env_file}"
    fail "Production env file is not valid dotenv"
    return 1
  fi

  while IFS= read -r -d '' env_name && IFS= read -r -d '' env_value; do
    printf -v "${env_name}" '%s' "${env_value}"
    export "${env_name?}"
  done < "${parsed_env_file}"
  rm -f "${parsed_env_file}"

  export PROJECT_ID="${INTEXURAOS_GCP_PROJECT_ID:-${PROJECT_ID}}"
  export NODE_ENV="production"
}

verify_whatsapp_message_digest_template() {
  node "${TEMPLATE_VERIFIER}"
}

json_field() {
  local path="$1"
  local field="$2"
  node -e '
const { readFileSync } = require("node:fs");
const value = JSON.parse(readFileSync(process.argv[1], "utf8"));
const fields = process.argv[2].split(".");
let current = value;
for (const field of fields) current = current?.[field];
if (typeof current !== "string" && typeof current !== "number" && typeof current !== "boolean") process.exit(1);
process.stdout.write(String(current));
' "${path}" "${field}"
}

json_text_field() {
  local value="$1"
  local field="$2"
  node -e '
const value = JSON.parse(process.argv[1]);
const fields = process.argv[2].split(".");
let current = value;
for (const field of fields) current = current?.[field];
if (typeof current !== "string" && typeof current !== "number" && typeof current !== "boolean") process.exit(1);
process.stdout.write(String(current));
' "${value}" "${field}"
}

configure_attempt_paths() {
  [[ "${CUTOVER_ATTEMPT}" =~ ^[1-9][0-9]*$ ]] || fail "Durable cutover attempt is invalid"
  ATTEMPT_DIR="${STATE_DIR}/attempts/${CUTOVER_ATTEMPT}"
  BINDING_FILE="${ATTEMPT_DIR}/fishing-binding.env"
  DRY_RUN_REPORT="${ATTEMPT_DIR}/migration-dry-run.json"
  APPLY_REPORT="${ATTEMPT_DIR}/migration-apply.json"
  VERIFY_REPORT="${ATTEMPT_DIR}/migration-verify.json"
  ACTIVATE_REPORT="${ATTEMPT_DIR}/migration-activate.json"
  ACTIVE_VERIFY_REPORT="${ATTEMPT_DIR}/migration-verify-active.json"
  POST_ADMISSION_VERIFY_REPORT="${ATTEMPT_DIR}/migration-verify-post-admission.json"
  STAGED_CANDIDATE_VERIFY_REPORT="${ATTEMPT_DIR}/candidate-verification-staged.json"
  ACTIVE_CANDIDATE_VERIFY_REPORT="${ATTEMPT_DIR}/candidate-verification-active.json"
  CANDIDATE_CONFIG="${ATTEMPT_DIR}/candidate-ecosystem.json"
  CANDIDATE_WEB_ROOT="${ATTEMPT_DIR}/candidate-web"
  WEB_RELEASE_DIR="${WEB_RELEASES_ROOT}/${MERGE_SHA}"
  TERRAFORM_DATA_ROOT="${ATTEMPT_DIR}/terraform-data"
  TERRAFORM_PLAN_ROOT="${ATTEMPT_DIR}/terraform-plans"
  RUNTIME_SWITCH_MARKER="${ATTEMPT_DIR}/runtime-switch.complete"
  mkdir -p "${ATTEMPT_DIR}" "${TERRAFORM_DATA_ROOT}" "${TERRAFORM_PLAN_ROOT}"
  chmod 700 "${ATTEMPT_DIR}"
}

state_completed_count() {
  local completed=""
  completed="$(node "${STATE_HELPER}" read --state "${STATE_PATH}" \
    | node -e '
let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => process.stdout.write(String(JSON.parse(input).completedStepCount)));
')" || fail "CUTOVER_COMPLETED_STEP_COUNT_INVALID"
  [[ "${completed}" =~ ^(0|[1-9][0-9]*)$ ]] \
    || fail "CUTOVER_COMPLETED_STEP_COUNT_INVALID"
  ((completed <= ${#STEP_NAMES[@]})) || fail "CUTOVER_COMPLETED_STEP_COUNT_INVALID"
  printf '%s' "${completed}"
}

checkpoint() {
  local step="$1"
  node "${STATE_HELPER}" checkpoint \
    --state "${STATE_PATH}" \
    --migration-id "mdm_${MERGE_SHA}" \
    --deployment-id "${DEPLOYMENT_ID}" \
    --step "${step}" \
    --now "$(now_iso)" >/dev/null
}

step_index() {
  local target="$1"
  local index=""
  for index in "${!STEP_NAMES[@]}"; do
    if [[ "${STEP_NAMES[${index}]}" == "${target}" ]]; then
      printf '%s' "${index}"
      return 0
    fi
  done
  return 1
}

run_step() {
  local step="$1"
  local operation="$2"
  local index=""
  local completed=""
  index="$(step_index "${step}")"
  completed="$(state_completed_count)"
  if ((completed > index)); then
    printf 'Resuming after completed step %s\n' "${step}"
    return 0
  fi
  ((completed == index)) || fail "Durable cutover checkpoint is out of order"
  if ((index < 15)); then
    assert_cutover_window_open
  fi
  printf 'Running cutover step %s\n' "${step}"
  "${operation}"
  checkpoint "${step}"
}

acquire_durable_lease() {
  local window_json=""
  local acquired_json=""
  mkdir -p "${STATE_DIR}"
  chmod 700 "${STATE_DIR}"
  window_json="$(node --input-type=module - "${SUPPORT_HELPER}" "${CUTOVER_START}" <<'NODE'
const [supportPath, start] = process.argv.slice(2);
const { computeCutoverWindow } = await import(`file://${supportPath}`);
process.stdout.write(`${JSON.stringify(computeCutoverWindow(start))}\n`);
NODE
)"
  CUTOVER_START="$(json_text_field "${window_json}" cutoverStart)"
  CUTOVER_DEADLINE="$(json_text_field "${window_json}" cutoverDeadline)"
  acquired_json="$(node "${STATE_HELPER}" acquire \
    --state "${STATE_PATH}" \
    --migration-id "mdm_${MERGE_SHA}" \
    --merge-sha "${MERGE_SHA}" \
    --tested-tree "${TESTED_TREE}" \
    --deployment-id "${DEPLOYMENT_ID}" \
    --release-dir "${RELEASE_DIR}" \
    --previous-release-dir "${PREVIOUS_RELEASE_DIR}" \
    --cutover-start "${CUTOVER_START}" \
    --cutover-deadline "${CUTOVER_DEADLINE}" \
    --now "$(now_iso)")"
  CUTOVER_START="$(json_text_field "${acquired_json}" cutoverStart)"
  CUTOVER_DEADLINE="$(json_text_field "${acquired_json}" cutoverDeadline)"
  CUTOVER_ATTEMPT="$(json_text_field "${acquired_json}" attempt)"
  CUTOVER_STATUS="$(json_text_field "${acquired_json}" status)"
  configure_attempt_paths
  if [[ "${CUTOVER_STATUS}" == "admitting" || "${CUTOVER_STATUS}" == "admitted" || "${CUTOVER_STATUS}" == "complete" ]]; then
    CUTOVER_ADMITTED="true"
  fi
}

verify_tested_release() {
  local observed_manifest=""
  [[ "$(basename "${RELEASE_DIR}")" == "${MERGE_SHA}" ]] \
    || fail "Immutable release directory does not match merge SHA"
  observed_manifest="$(node "${RELEASE_DIR}/scripts/hetzner/hash-release-tree.mjs" "${RELEASE_DIR}")"
  [[ "${observed_manifest}" == "${RELEASE_MANIFEST_HASH}" ]] \
    || fail "Staged release manifest does not match the tested archive"
}

assert_pending_migration_128() {
  local status_file="${ATTEMPT_DIR}/pending-migrations.txt"
  GOOGLE_APPLICATION_CREDENTIALS="${GOOGLE_APPLICATION_CREDENTIALS}" \
    node "${RELEASE_DIR}/scripts/migrate.mjs" --status --project "${PROJECT_ID}" > "${status_file}"
  node --input-type=module - "${SUPPORT_HELPER}" "${status_file}" <<'NODE'
import { readFileSync } from 'node:fs';
const [supportPath, statusPath] = process.argv.slice(2);
const { assertMigration128CutoverReadiness } = await import(`file://${supportPath}`);
assertMigration128CutoverReadiness(readFileSync(statusPath, 'utf8'));
NODE
}

wait_for_health() {
  local url="$1"
  local deadline=$((SECONDS + 180))
  while ((SECONDS < deadline)); do
    if curl --fail --silent --show-error --max-time 5 "${url}" >/dev/null; then
      return 0
    fi
    sleep 3
  done
  fail "Candidate health check did not become ready"
}

start_candidate_stack() {
  local service=""
  umask 077
  INTEXURAOS_COMMIT_SHA="${MERGE_SHA}" INTEXURAOS_ENVIRONMENT=prod \
    node "${RELEASE_DIR}/scripts/hetzner/render-message-digest-candidate.mjs" \
    "${RELEASE_DIR}/ecosystem.config.prod.cjs" > "${CANDIDATE_CONFIG}"
  chmod 600 "${CANDIDATE_CONFIG}"
  for service in whatsapp-service mobile-notifications-service fishing-assistant-service message-digest-service; do
    pm2 delete "candidate-${service}" >/dev/null 2>&1 || true
  done
  pm2 start "${CANDIDATE_CONFIG}" --update-env
  for service in 18113 18114 18119 18135; do
    wait_for_health "http://127.0.0.1:${service}/health"
  done
  COMMIT_SHA="${MERGE_SHA}" COMMIT_MESSAGE="WhatsApp Message Digests candidate" \
    INTEXURAOS_ENVIRONMENT=prod bash "${RELEASE_DIR}/scripts/hetzner/deploy-web.sh" \
    --repo-dir "${RELEASE_DIR}" --env-file "${ENV_FILE}" --web-root "${CANDIDATE_WEB_ROOT}"
  [[ -f "${CANDIDATE_WEB_ROOT}/index.html" ]] || fail "Candidate Web build is missing"
  ensure_legacy_web_pointer
  sudo -n INTEXURAOS_ENVIRONMENT=prod \
    bash "${RELEASE_DIR}/scripts/hetzner/deploy-nginx.sh" --message-digests-candidate-unavailable
}

ensure_binding_file() {
  if [[ ! -r "${BINDING_FILE}" ]]; then
    GOOGLE_APPLICATION_CREDENTIALS="${GOOGLE_APPLICATION_CREDENTIALS}" \
      INTEXURAOS_WHATSAPP_SERVICE_URL="http://127.0.0.1:18113" \
      node "${RELEASE_DIR}/scripts/message-digests/resolve-fishing-migration-binding.mjs" \
      --project-id "${PROJECT_ID}" \
      --previous-release "${PREVIOUS_RELEASE_DIR}" \
      --output "${BINDING_FILE}" >/dev/null
  fi
  chmod 600 "${BINDING_FILE}"
  set -a
  # shellcheck disable=SC1090
  source "${BINDING_FILE}"
  set +a
}

migration_whatsapp_service_url() {
  local completed=""
  completed="$(state_completed_count)"
  if [[ -f "${RUNTIME_SWITCH_MARKER}" ]] || ((completed >= 14)); then
    printf 'http://127.0.0.1:8113'
  else
    printf 'http://127.0.0.1:18113'
  fi
}

run_migration() {
  local mode="$1"
  local output="$2"
  local whatsapp_service_url=""
  shift 2
  whatsapp_service_url="$(migration_whatsapp_service_url)"
  run_migration_at_whatsapp_url "${mode}" "${output}" "${whatsapp_service_url}" "$@"
}

run_migration_at_whatsapp_url() {
  local mode="$1"
  local output="$2"
  local whatsapp_service_url="$3"
  shift 3
  ensure_binding_file
  INTEXURAOS_WHATSAPP_SERVICE_URL="${whatsapp_service_url}" \
    INTEXURAOS_LLM_USAGE_SERVICE_URL="http://127.0.0.1:8132" \
    INTEXURAOS_DIGEST_LLM_MODEL="${INTEXURAOS_DIGEST_LLM_MODEL:-or:google/gemini-3.6-flash}" \
    GOOGLE_APPLICATION_CREDENTIALS="${GOOGLE_APPLICATION_CREDENTIALS}" \
    node "${RELEASE_DIR}/scripts/message-digests/migrate-fishing-group.mjs" \
    "${mode}" --migration-id "mdm_${MERGE_SHA}" "$@" > "${output}"
  chmod 600 "${output}"
}

start_candidate_compensation_stack() {
  local service=""
  [[ -r "${CANDIDATE_CONFIG}" ]] || fail "Candidate compensation ecosystem is missing"
  for service in whatsapp-service mobile-notifications-service fishing-assistant-service message-digest-service; do
    pm2 delete "candidate-${service}" >/dev/null 2>&1 || true
  done
  pm2 start "${CANDIDATE_CONFIG}" --update-env
  for service in 18113 18114 18119 18135; do
    wait_for_health "http://127.0.0.1:${service}/health"
  done
}

restart_candidate_stack_for_resumed_pre_activation() {
  local completed=""
  completed="$(state_completed_count)"
  if ((completed >= 3 && completed < 14)); then
    start_candidate_compensation_stack
  fi
}

stop_candidate_compensation_stack() {
  local service=""
  local failed="0"
  for service in whatsapp-service mobile-notifications-service fishing-assistant-service message-digest-service; do
    if ! pm2 delete "candidate-${service}" >/dev/null 2>&1; then
      failed=1
    fi
  done
  return "${failed}"
}

compensate_staged_migration_after_runtime_restore() {
  local compensation_failed="0"
  if ! start_candidate_compensation_stack; then
    stop_candidate_compensation_stack || true
    return 1
  fi
  if ! run_migration_at_whatsapp_url \
    --compensate \
    "${ATTEMPT_DIR}/migration-compensate.json" \
    "http://127.0.0.1:18113"; then
    compensation_failed=1
  fi
  if ! stop_candidate_compensation_stack; then
    compensation_failed=1
  fi
  return "${compensation_failed}"
}

migration_dry_run() {
  run_migration --dry-run "${DRY_RUN_REPORT}"
}

estimate_window() {
  local estimate_file="${ATTEMPT_DIR}/cutover-estimate.json"
  local replay_dates=""
  replay_dates="$(json_field "${DRY_RUN_REPORT}" counts.replayDates)"
  node --input-type=module - \
    "${SUPPORT_HELPER}" "${CUTOVER_START}" "${replay_dates}" > "${estimate_file}" <<'NODE'
const [supportPath, start, replayDates] = process.argv.slice(2);
const support = await import(`file://${supportPath}`);
const window = support.computeCutoverWindow(start);
const estimate = support.estimateCutoverDurationSeconds({ replayDates: Number(replayDates), terraformChanges: 22 });
process.stdout.write(`${JSON.stringify(support.assertCutoverEstimateFits(window, estimate))}\n`);
NODE
  chmod 600 "${estimate_file}"
}

terraform_environment() {
  env \
    -u HCLOUD_TOKEN \
    -u STORAGE_EMULATOR_HOST \
    -u FIRESTORE_EMULATOR_HOST \
    -u PUBSUB_EMULATOR_HOST \
    GOOGLE_APPLICATION_CREDENTIALS="${HETZNER_PROVISIONER_GOOGLE_APPLICATION_CREDENTIALS:-/home/deploy/provisioner-sa-key.json}" \
    TF_VAR_project_id="${PROJECT_ID}" \
    TF_VAR_github_owner="${TERRAFORM_GITHUB_OWNER}" \
    TF_VAR_github_connection_name="${TERRAFORM_GITHUB_CONNECTION_NAME}" \
    "$@"
}

validate_terraform_plan() {
  local contract="$1"
  local plan_json="$2"
  node --input-type=module - "${SUPPORT_HELPER}" "${contract}" "${plan_json}" <<'NODE'
import { readFileSync } from 'node:fs';
const [supportPath, contract, planPath] = process.argv.slice(2);
const { validateTerraformPlan } = await import(`file://${supportPath}`);
validateTerraformPlan(contract, JSON.parse(readFileSync(planPath, 'utf8')));
NODE
}

plan_terraform() {
  local contract="$1"
  local root="$2"
  local data_dir="$3"
  local plan_file="$4"
  shift 4
  local target_args=("$@")
  local plan_json="${plan_file}.json"
  mkdir -p "${data_dir}" "$(dirname "${plan_file}")" || return $?
  terraform_environment TF_DATA_DIR="${data_dir}" \
    terraform -chdir="${root}" init -input=false -reconfigure || return $?
  terraform_environment TF_DATA_DIR="${data_dir}" \
    terraform -chdir="${root}" plan -input=false -lock-timeout=5m \
    "${target_args[@]}" -out="${plan_file}" || return $?
  terraform_environment TF_DATA_DIR="${data_dir}" \
    terraform -chdir="${root}" show -json "${plan_file}" > "${plan_json}" || return $?
  validate_terraform_plan "${contract}" "${plan_json}" || return $?
}

write_durable_marker() {
  local marker_path="$1"
  node --input-type=module - "${marker_path}" <<'NODE'
import {
  closeSync,
  fsyncSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute } from 'node:path';

const markerPath = process.argv[2];
if (
  !isAbsolute(markerPath) ||
  !/^terraform-(?:dev|prod)-forward\.apply-started$/u.test(basename(markerPath))
) {
  process.exit(1);
}

const directory = dirname(markerPath);
const temporaryPath = `${markerPath}.${process.pid}.${Date.now()}.tmp`;
let markerDescriptor;
let renamed = false;
try {
  markerDescriptor = openSync(temporaryPath, 'wx', 0o600);
  writeFileSync(markerDescriptor, 'apply-started\n', 'utf8');
  fsyncSync(markerDescriptor);
  closeSync(markerDescriptor);
  markerDescriptor = undefined;
  renameSync(temporaryPath, markerPath);
  renamed = true;
  const directoryDescriptor = openSync(directory, 'r');
  try {
    fsyncSync(directoryDescriptor);
  } finally {
    closeSync(directoryDescriptor);
  }
} finally {
  if (markerDescriptor !== undefined) closeSync(markerDescriptor);
  if (!renamed) {
    try {
      unlinkSync(temporaryPath);
    } catch {}
  }
}
NODE
}

plan_and_apply_terraform() {
  local contract="$1"
  local root="$2"
  local data_dir="$3"
  local plan_file="$4"
  local apply_started_marker="$5"
  shift 5
  local target_args=("$@")
  plan_terraform \
    "${contract}" \
    "${root}" \
    "${data_dir}" \
    "${plan_file}" \
    "${target_args[@]}" || return $?
  if [[ -n "${apply_started_marker}" ]]; then
    write_durable_marker "${apply_started_marker}" || return $?
  fi
  terraform_environment TF_DATA_DIR="${data_dir}" \
    terraform -chdir="${root}" apply -input=false -auto-approve "${plan_file}" || return $?
}

forward_terraform_dev() {
  plan_and_apply_terraform \
    dev \
    "${RELEASE_DIR}/terraform/environments/dev" \
    "${TERRAFORM_DATA_ROOT}/dev-forward" \
    "${TERRAFORM_PLAN_ROOT}/dev-forward.tfplan" \
    "${ATTEMPT_DIR}/terraform-dev-forward.apply-started" \
    "${DEV_TERRAFORM_TARGETS[@]}"
}

forward_terraform_prod() {
  plan_and_apply_terraform \
    prod \
    "${RELEASE_DIR}/terraform/hetzner-prod" \
    "${TERRAFORM_DATA_ROOT}/prod-forward" \
    "${TERRAFORM_PLAN_ROOT}/prod-forward.tfplan" \
    "${ATTEMPT_DIR}/terraform-prod-forward.apply-started" \
    "${PROD_TERRAFORM_TARGETS[@]}"
}

verify_inverse_terraform_plans() {
  plan_terraform \
    prod-inverse-complete \
    "${PREVIOUS_RELEASE_DIR}/terraform/hetzner-prod" \
    "${TERRAFORM_DATA_ROOT}/prod-inverse-proof" \
    "${TERRAFORM_PLAN_ROOT}/prod-inverse-proof.tfplan" \
    "${PROD_TERRAFORM_TARGETS[@]}"
  plan_terraform \
    dev-inverse-complete \
    "${PREVIOUS_RELEASE_DIR}/terraform/environments/dev" \
    "${TERRAFORM_DATA_ROOT}/dev-inverse-proof" \
    "${TERRAFORM_PLAN_ROOT}/dev-inverse-proof.tfplan" \
    "${DEV_TERRAFORM_TARGETS[@]}"
}

apply_migration_128() {
  GOOGLE_APPLICATION_CREDENTIALS="${GOOGLE_APPLICATION_CREDENTIALS}" \
    node "${RELEASE_DIR}/scripts/migrate.mjs" --project "${PROJECT_ID}"
}

deadline_has_time() {
  node -e '
const deadline = Date.parse(process.argv[1]);
process.exit(Number.isFinite(deadline) && Date.now() + 30_000 < deadline ? 0 : 1);
' "${CUTOVER_DEADLINE}"
}

assert_cutover_window_open() {
  deadline_has_time || fail "The durable cutover window has expired"
}

wait_index_readiness() {
  local indexes_file="${ATTEMPT_DIR}/firestore-indexes.json"
  while deadline_has_time; do
    CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE="${HETZNER_PROVISIONER_GOOGLE_APPLICATION_CREDENTIALS:-/home/deploy/provisioner-sa-key.json}" \
      gcloud firestore indexes composite list \
      --project "${PROJECT_ID}" --format=json > "${indexes_file}"
    if node -e '
const { readFileSync } = require("node:fs");
const indexes = JSON.parse(readFileSync(process.argv[1], "utf8"));
process.exit(Array.isArray(indexes) && indexes.every((index) => index.state === "READY") ? 0 : 1);
' "${indexes_file}"; then
      return 0
    fi
    sleep 30
  done
  fail "Firestore indexes did not become ready before the cutover deadline"
}

migration_apply() {
  run_migration --apply "${APPLY_REPORT}"
}

migration_verify() {
  run_migration --verify "${VERIFY_REPORT}"
}

assert_zero_outbound_report() {
  local report="$1"
  node -e '
const { readFileSync } = require("node:fs");
const report = JSON.parse(readFileSync(process.argv[1], "utf8"));
if (report?.counts?.outboundEffects !== 0) process.exit(1);
' "${report}" || fail "Candidate migration produced an outbound effect"
}

expect_status() {
  local expected="$1"
  local url="$2"
  shift 2
  local status=""
  status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --max-time 10 "$@" "${url}")"
  [[ "${status}" == "${expected}" ]] || fail "Candidate rejection contract failed"
}

verify_message_digest_candidate() {
  local phase="$1"
  ensure_binding_file
  if [[ "${phase}" == "staged" ]]; then
    node "${RELEASE_DIR}/scripts/hetzner/verify-message-digest-candidate.mjs" \
      --phase staged \
      --whatsapp-port 18113 \
      --mobile-port 18114 \
      --fishing-port 18119 \
      --message-digest-port 18135 \
      --migration-id "mdm_${MERGE_SHA}" \
      --web-root "${CANDIDATE_WEB_ROOT}" \
      --dry-run-report "${DRY_RUN_REPORT}" \
      --apply-report "${APPLY_REPORT}" \
      --verify-report "${VERIFY_REPORT}" > "${STAGED_CANDIDATE_VERIFY_REPORT}"
    chmod 600 "${STAGED_CANDIDATE_VERIFY_REPORT}"
    return 0
  fi
  [[ "${phase}" == "active" ]] || fail "Unsupported Message Digest candidate phase"
  node "${RELEASE_DIR}/scripts/hetzner/verify-message-digest-candidate.mjs" \
    --phase active \
    --whatsapp-port 8113 \
    --mobile-port 8114 \
    --fishing-port 8119 \
    --message-digest-port 8135 \
    --migration-id "mdm_${MERGE_SHA}" \
    --web-root "${CANDIDATE_WEB_ROOT}" \
    --dry-run-report "${DRY_RUN_REPORT}" \
    --apply-report "${APPLY_REPORT}" \
    --verify-report "${ACTIVE_VERIFY_REPORT}" \
    --activation-report "${ACTIVATE_REPORT}" > "${ACTIVE_CANDIDATE_VERIFY_REPORT}"
  chmod 600 "${ACTIVE_CANDIDATE_VERIFY_REPORT}"
}

candidate_zero_send_proof() {
  assert_zero_outbound_report "${DRY_RUN_REPORT}"
  assert_zero_outbound_report "${APPLY_REPORT}"
  assert_zero_outbound_report "${VERIFY_REPORT}"
  expect_status 401 "http://127.0.0.1:18135/internal/message-digests/scheduler/tick" \
    --request POST --header 'Content-Type: application/json' --data '{}'
  expect_status 401 "http://127.0.0.1:18135/internal/message-digests/pubsub/run" \
    --request POST --header 'Content-Type: application/json' \
    --data '{"message":{"data":"e30=","messageId":"candidate-proof","publishTime":"2026-01-01T00:00:00.000Z"},"subscription":"candidate-proof"}'
  curl --fail --silent --show-error --max-time 10 http://127.0.0.1:8114/health >/dev/null
  expect_status 503 "https://intexuraos.cloud/api/message-digests" \
    --resolve 'intexuraos.cloud:443:127.0.0.1'
  verify_message_digest_candidate staged
}

switch_runtime_under_hold() {
  sudo -n INTEXURAOS_ENVIRONMENT=prod \
    bash "${RELEASE_DIR}/scripts/hetzner/deploy-nginx.sh" --message-digests-full-cutover-hold
  INTEXURAOS_COMMIT_SHA="${MERGE_SHA}" INTEXURAOS_ENVIRONMENT=prod \
    bash "${RELEASE_DIR}/scripts/hetzner/reload-pm2.sh" \
    --config "${RELEASE_DIR}/ecosystem.config.prod.cjs"
  : > "${RUNTIME_SWITCH_MARKER}"
  chmod 600 "${RUNTIME_SWITCH_MARKER}"
  for service in 8113 8114 8119 8135; do
    wait_for_health "http://127.0.0.1:${service}/health"
  done
}

migration_activate() {
  verify_whatsapp_message_digest_template
  run_migration --activate "${ACTIVATE_REPORT}" --cutover-deadline "${CUTOVER_DEADLINE}"
  assert_zero_outbound_report "${ACTIVATE_REPORT}"
  run_migration --verify "${ACTIVE_VERIFY_REPORT}"
  assert_zero_outbound_report "${ACTIVE_VERIFY_REPORT}"
  verify_message_digest_candidate active
}

ensure_legacy_web_pointer() {
  local next_link=""
  if [[ -L "${WEB_CURRENT_LINK}" ]]; then
    [[ -f "${WEB_CURRENT_LINK}/index.html" ]] || fail "Current Web release is invalid"
    return 0
  fi
  [[ ! -e "${WEB_CURRENT_LINK}" ]] || fail "Current Web pointer is not a symlink"
  [[ -f "${LEGACY_WEB_ROOT}/index.html" ]] || fail "Legacy Web release is missing"
  install -d -m 755 "$(dirname "${WEB_CURRENT_LINK}")"
  next_link="$(mktemp "${WEB_CURRENT_LINK}.next.XXXXXX")"
  rm -f -- "${next_link}"
  ln -s "${LEGACY_WEB_ROOT}" "${next_link}"
  mv -Tf "${next_link}" "${WEB_CURRENT_LINK}"
}

stage_candidate_web_release() {
  local staging_dir=""
  local differences=""
  [[ -f "${CANDIDATE_WEB_ROOT}/index.html" ]] || fail "Candidate Web build is missing"
  install -d -m 755 "${WEB_RELEASES_ROOT}"
  if [[ -e "${WEB_RELEASE_DIR}" || -L "${WEB_RELEASE_DIR}" ]]; then
    [[ -d "${WEB_RELEASE_DIR}" && ! -L "${WEB_RELEASE_DIR}" && -f "${WEB_RELEASE_DIR}/index.html" ]] \
      || fail "Existing candidate Web release is invalid"
    differences="$(rsync -rcln --delete --itemize-changes --exclude deployment.json \
      "${CANDIDATE_WEB_ROOT}/" "${WEB_RELEASE_DIR}/")"
    [[ -z "${differences}" ]] || fail "Existing candidate Web release differs"
    return 0
  fi
  staging_dir="$(mktemp -d "${WEB_RELEASES_ROOT}/.${MERGE_SHA}.XXXXXX")"
  rsync -a --delete "${CANDIDATE_WEB_ROOT}/" "${staging_dir}/"
  [[ -f "${staging_dir}/index.html" ]] || fail "Staged candidate Web release is incomplete"
  chmod 755 "${staging_dir}"
  mv -T "${staging_dir}" "${WEB_RELEASE_DIR}"
}

activate_candidate_web_release() {
  local next_link=""
  [[ -d "${WEB_RELEASE_DIR}" && ! -L "${WEB_RELEASE_DIR}" && -f "${WEB_RELEASE_DIR}/index.html" ]] \
    || fail "Candidate Web release is not ready for activation"
  next_link="$(mktemp "${WEB_CURRENT_LINK}.next.XXXXXX")"
  rm -f -- "${next_link}"
  ln -s "${WEB_RELEASE_DIR}" "${next_link}"
  mv -Tf "${next_link}" "${WEB_CURRENT_LINK}"
}

public_admission() {
  stage_candidate_web_release
  activate_candidate_web_release
  ln -sfn "${RELEASE_DIR}" "${CURRENT_RELEASE_LINK}"
  sudo -n INTEXURAOS_ENVIRONMENT=prod \
    bash "${RELEASE_DIR}/scripts/hetzner/deploy-nginx.sh" --message-digests-public
}

resume_admitted_public_ingress() {
  local completed="$1"
  if ((completed != 16)); then
    return 0
  fi
  [[ "${CUTOVER_STATUS}" == "admitted" ]] \
    || fail "Completed public admission has an invalid durable status"
  public_admission
}

post_admission_verify() {
  curl --fail --silent --show-error --max-time 15 \
    https://intexuraos.cloud/api/message-digests/health >/dev/null
  curl --fail --silent --show-error --max-time 15 \
    https://intexuraos.cloud/api/fishing-assistant/health >/dev/null
  curl --fail --silent --show-error --max-time 15 \
    https://intexuraos.cloud/api/notifications/health >/dev/null
  run_migration --verify "${POST_ADMISSION_VERIFY_REPORT}"
}

rollback_terraform_prod() {
  plan_and_apply_terraform \
    prod-inverse \
    "${PREVIOUS_RELEASE_DIR}/terraform/hetzner-prod" \
    "${TERRAFORM_DATA_ROOT}/prod-inverse" \
    "${TERRAFORM_PLAN_ROOT}/prod-inverse.tfplan" \
    "" \
    "${PROD_TERRAFORM_TARGETS[@]}"
}

rollback_terraform_dev() {
  plan_and_apply_terraform \
    dev-inverse \
    "${PREVIOUS_RELEASE_DIR}/terraform/environments/dev" \
    "${TERRAFORM_DATA_ROOT}/dev-inverse" \
    "${TERRAFORM_PLAN_ROOT}/dev-inverse.tfplan" \
    "" \
    "${DEV_TERRAFORM_TARGETS[@]}"
}

hold_affected_ingress_fail_closed() {
  sudo -n INTEXURAOS_ENVIRONMENT=prod \
    bash "${RELEASE_DIR}/scripts/hetzner/deploy-nginx.sh" --message-digests-full-cutover-hold
}

restore_previous_runtime() {
  INTEXURAOS_COMMIT_SHA="${PREVIOUS_RELEASE_SHA}" INTEXURAOS_ENVIRONMENT=prod \
    bash "${PREVIOUS_RELEASE_DIR}/scripts/hetzner/reload-pm2.sh" \
    --config "${PREVIOUS_RELEASE_DIR}/ecosystem.config.prod.cjs"
  wait_for_health "http://127.0.0.1:8114/health"
  ln -sfn "${PREVIOUS_RELEASE_DIR}" "${CURRENT_RELEASE_LINK}"
}

restore_previous_ingress() {
  local previous_nginx="${PREVIOUS_RELEASE_DIR}/scripts/hetzner/deploy-nginx.sh"
  local legacy_status=""
  if grep -q -- '--message-digests-public' "${previous_nginx}"; then
    sudo -n INTEXURAOS_ENVIRONMENT=prod bash "${previous_nginx}" --message-digests-public
  else
    sudo -n INTEXURAOS_ENVIRONMENT=prod bash "${previous_nginx}"
  fi
  legacy_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --max-time 10 --request POST \
    http://127.0.0.1:8114/internal/notifications/digest/run-yesterday)"
  [[ "${legacy_status}" == "401" ]] || fail "Previous Mobile legacy endpoint proof failed"
}

rollback_pre_admission() {
  local completed="0"
  local rollback_failed="0"
  if [[ "${ROLLBACK_RUNNING}" == "true" || ! -f "${STATE_PATH}" ]]; then
    return 0
  fi
  ROLLBACK_RUNNING="true"
  if [[ "${CUTOVER_ADMITTED}" == "true" ]]; then
    printf 'refusing pre-admission compensation after public admission\n' >&2
    hold_affected_ingress_fail_closed || true
    return 0
  fi
  if ! node "${STATE_HELPER}" assert-compensation --state "${STATE_PATH}" >/dev/null; then
    printf 'refusing pre-admission compensation after public admission\n' >&2
    CUTOVER_ADMITTED="true"
    hold_affected_ingress_fail_closed || true
    return 0
  fi
  if ! node "${STATE_HELPER}" begin-compensation \
    --state "${STATE_PATH}" \
    --migration-id "mdm_${MERGE_SHA}" \
    --deployment-id "${DEPLOYMENT_ID}" \
    --now "$(now_iso)" >/dev/null; then
    printf 'ERROR: Could not acquire durable Message Digest compensation ownership\n' >&2
    return 1
  fi
  completed="$(state_completed_count)"
  if ! hold_affected_ingress_fail_closed; then
    printf 'ERROR: Could not hold Message Digest ingress during rollback\n' >&2
    rollback_failed=1
  fi
  if ! restore_previous_runtime; then
    printf 'ERROR: Could not restore the previous immutable runtime\n' >&2
    rollback_failed=1
  fi
  if ((completed >= 11)) && [[ -r "${BINDING_FILE}" ]]; then
    if ! compensate_staged_migration_after_runtime_restore; then
      printf 'ERROR: Could not compensate the staged Message Digest migration\n' >&2
      rollback_failed=1
    fi
  fi
  if [[ -f "${ATTEMPT_DIR}/terraform-prod-forward.apply-started" ]]; then
    if ! rollback_terraform_prod; then
      printf 'ERROR: Could not restore the production Terraform root\n' >&2
      rollback_failed=1
    fi
  fi
  if [[ -f "${ATTEMPT_DIR}/terraform-dev-forward.apply-started" ]]; then
    if ! rollback_terraform_dev; then
      printf 'ERROR: Could not restore the development Terraform root\n' >&2
      rollback_failed=1
    fi
  fi
  if ((rollback_failed == 0)); then
    if ! restore_previous_ingress; then
      printf 'ERROR: Could not restore the previous immutable ingress\n' >&2
      rollback_failed=1
    fi
  fi
  if ((rollback_failed == 0)); then
    if ! node "${STATE_HELPER}" mark-compensated \
      --state "${STATE_PATH}" \
      --migration-id "mdm_${MERGE_SHA}" \
      --deployment-id "${DEPLOYMENT_ID}" \
      --now "$(now_iso)" >/dev/null; then
      printf 'ERROR: Could not persist completed Message Digest compensation\n' >&2
      rollback_failed=1
    fi
  fi
  return "${rollback_failed}"
}

on_error() {
  local status=$?
  local rollback_status=0
  trap - ERR
  rollback_pre_admission || rollback_status=$?
  if ((rollback_status != 0)); then
    printf 'ERROR: Pre-admission rollback was incomplete; manual recovery is required\n' >&2
    hold_affected_ingress_fail_closed || true
  fi
  exit "${status}"
}

main() {
  require_command curl
  require_command gcloud
  require_command node
  require_command pm2
  require_command pnpm
  require_command rsync
  require_command terraform
  validate_inputs
  load_runtime_environment
  verify_whatsapp_message_digest_template
  trap on_error ERR
  acquire_durable_lease
  if [[ "${CUTOVER_STATUS}" == "compensating" ]]; then
    fail "Previous Message Digest compensation is incomplete"
  fi
  restart_candidate_stack_for_resumed_pre_activation

  run_step "verify-tested-release" verify_tested_release
  run_step "assert-pending-migration-128" assert_pending_migration_128
  run_step "start-candidate-stack" start_candidate_stack
  run_step "migration-dry-run" migration_dry_run
  run_step "estimate-window" estimate_window
  run_step "terraform-dev-forward" forward_terraform_dev
  run_step "migration-128" apply_migration_128
  run_step "wait-index-readiness" wait_index_readiness
  run_step "terraform-prod-forward" forward_terraform_prod
  run_step "terraform-inverse-proof" verify_inverse_terraform_plans
  run_step "migration-apply" migration_apply
  run_step "migration-verify" migration_verify
  run_step "candidate-zero-send-proof" candidate_zero_send_proof
  run_step "switch-runtime-under-hold" switch_runtime_under_hold
  run_step "migration-activate" migration_activate

  local completed=""
  completed="$(state_completed_count)"
  if ((completed == 15)); then
    if [[ "${CUTOVER_STATUS}" == "in_progress" ]]; then
      assert_cutover_window_open
    fi
    node "${STATE_HELPER}" begin-admission \
      --state "${STATE_PATH}" \
      --migration-id "mdm_${MERGE_SHA}" \
      --deployment-id "${DEPLOYMENT_ID}" \
      --now "$(now_iso)" >/dev/null
    CUTOVER_ADMITTED="true"
    public_admission
    checkpoint "public-admission"
  elif ((completed == 16)); then
    resume_admitted_public_ingress "${completed}"
  fi
  run_step "post-admission-verify" post_admission_verify
  node "${STATE_HELPER}" complete \
    --state "${STATE_PATH}" \
    --migration-id "mdm_${MERGE_SHA}" \
    --deployment-id "${DEPLOYMENT_ID}" \
    --now "$(now_iso)" >/dev/null
  trap - ERR
  printf 'WhatsApp Message Digests production cutover completed\n'
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
