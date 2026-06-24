#!/usr/bin/env bash

set -euo pipefail
IFS=$'\n\t'

PROJECT_ID="${PROJECT_ID:-intexuraos-dev-pbuchman}"
REGION="${REGION:-europe-central2}"
ENVIRONMENT="${ENVIRONMENT:-dev}"
PUBLIC_ORIGIN="${PUBLIC_ORIGIN:-https://intexuraos.cloud}"
SCHEDULER_SERVICE_ACCOUNT_EMAIL="${SCHEDULER_SERVICE_ACCOUNT_EMAIL:-intexuraos-scheduler-${ENVIRONMENT}@${PROJECT_ID}.iam.gserviceaccount.com}"
APPLY=0

PUBSUB_ROUTES=(
  "intexuraos-pr-triage|intexuraos-code|/internal/code/pubsub/pr-triage"
  "intexuraos-whatsapp-media-cleanup|intexuraos-whatsapp-svc|/internal/whatsapp/pubsub/media-cleanup"
  "intexuraos-whatsapp-webhook-process|intexuraos-whatsapp-svc|/internal/whatsapp/pubsub/process-webhook"
  "intexuraos-srt-transcription-completed|intexuraos-whatsapp-svc|/internal/whatsapp/pubsub/transcription-completed"
  "intexuraos-commands-ingest|intexuraos-commands-agents|/internal/commands"
  "intexuraos-intex-message-ingest|intexuraos-intex-agent|/internal/intex-agent/messages"
  "intexuraos-actions-queue|intexuraos-actions|/internal/actions/process"
  "intexuraos-research-process|intexuraos-research-agent|/internal/llm/pubsub/process-research"
  "intexuraos-llm-analytics|intexuraos-research-agent|/internal/llm/pubsub/report-analytics"
  "intexuraos-llm-call|intexuraos-research-agent|/internal/llm/pubsub/process-llm-call"
  "intexuraos-whatsapp-send|intexuraos-whatsapp-svc|/internal/whatsapp/pubsub/send-message"
  "intexuraos-approval-reply|intexuraos-actions|/internal/actions/approval-reply"
  "intexuraos-bookmark-enrich|intexuraos-bookmarks|/internal/bookmarks/pubsub/enrich"
  "intexuraos-bookmark-summarize|intexuraos-bookmarks|/internal/bookmarks/pubsub/summarize"
  "intexuraos-calendar-preview|intexuraos-calendar|/internal/calendar/generate-preview"
  "intexuraos-transcription-completed|intexuraos-whatsapp-svc|/internal/whatsapp/pubsub/transcription-completed"
)

SCHEDULER_ROUTES=(
  "mobile-notifications-digest-yesterday|/internal/notifications/digest/run-yesterday"
  "intexuraos-linear-sync-hourly|/internal/linear/sync-all"
  "intexuraos-linear-issues-prune-hourly|/internal/linear/prune-issues"
  "intexuraos-retry-pending-commands|/internal/retry-pending"
  "intexuraos-retry-pending-actions|/internal/actions/retry-pending"
  "intexuraos-drain-task-queue|/internal/drain-queue"
  "intexuraos-merge-conflict-reconcile|/internal/merge-conflicts/reconcile"
  "intexuraos-merge-queue-tick|/internal/merge-queue/tick"
  "intexuraos-code-tasks-zombie-sweep|/internal/code/detect-zombies"
  "intexuraos-archive-stale-groups|/internal/archive-stale-groups"
  "intexuraos-auto-archive-merged-tasks|/internal/auto-archive-merged-tasks"
  "intexuraos-execution-memory-process|/internal/execution-memory/process"
  "intexuraos-execution-memory-sweep-errored|/internal/execution-memory/sweep-errored"
  "intexuraos-execution-memory-prune-stale|/internal/execution-memory/prune-stale"
)

usage() {
  printf 'Usage: %s [--apply]\n\n' "$(basename "$0")"
  cat <<USAGE

Prints gcloud commands that move retained GCP Pub/Sub push subscriptions and
Cloud Scheduler HTTP jobs from Cloud Run service URLs to the Hetzner nginx edge.
Set PROJECT_ID, REGION, ENVIRONMENT, PUBLIC_ORIGIN, or
SCHEDULER_SERVICE_ACCOUNT_EMAIL to override defaults.

Without --apply, commands are only printed.
USAGE
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

validate_public_origin() {
  if [[ ! "${PUBLIC_ORIGIN}" =~ ^https://[A-Za-z0-9.-]+$ ]]; then
    fail "PUBLIC_ORIGIN must be an https:// origin without a path"
  fi
  if [[ "${PUBLIC_ORIGIN}" != "https://intexuraos.cloud" ]]; then
    fail "PUBLIC_ORIGIN must be exactly https://intexuraos.cloud"
  fi
}

quote_command() {
  printf '%q ' "$@"
  printf '\n'
}

run_or_print() {
  if [[ "${APPLY}" -eq 1 ]]; then
    "$@"
  else
    quote_command "$@"
  fi
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --apply)
        APPLY=1
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

service_account_email() {
  local account_id_stem="$1"
  printf '%s-%s@%s.iam.gserviceaccount.com' "${account_id_stem}" "${ENVIRONMENT}" "${PROJECT_ID}"
}

cutover_pubsub() {
  local route=""
  local topic_stem=""
  local account_id_stem=""
  local path=""
  local subscription_name=""

  for route in "${PUBSUB_ROUTES[@]}"; do
    IFS='|' read -r topic_stem account_id_stem path <<< "${route}"
    subscription_name="${topic_stem}-${ENVIRONMENT}-push"
    run_or_print gcloud pubsub subscriptions update "${subscription_name}" \
      --project="${PROJECT_ID}" \
      --push-endpoint="${PUBLIC_ORIGIN}${path}" \
      --push-auth-service-account="$(service_account_email "${account_id_stem}")" \
      --push-auth-token-audience="${PUBLIC_ORIGIN}"
  done
}

cutover_scheduler() {
  local route=""
  local job_stem=""
  local path=""
  local job_name=""

  for route in "${SCHEDULER_ROUTES[@]}"; do
    IFS='|' read -r job_stem path <<< "${route}"
    job_name="${job_stem}-${ENVIRONMENT}"
    run_or_print gcloud scheduler jobs update http "${job_name}" \
      --project="${PROJECT_ID}" \
      --location="${REGION}" \
      --uri="${PUBLIC_ORIGIN}${path}" \
      --oidc-service-account-email="${SCHEDULER_SERVICE_ACCOUNT_EMAIL}" \
      --oidc-token-audience="${PUBLIC_ORIGIN}"
  done
}

main() {
  parse_args "$@"
  PUBLIC_ORIGIN="${PUBLIC_ORIGIN%/}"
  validate_public_origin

  if [[ "${APPLY}" -eq 1 ]]; then
    command -v gcloud >/dev/null 2>&1 || fail "gcloud CLI is required"
  fi

  cutover_pubsub
  cutover_scheduler
}

main "$@"
