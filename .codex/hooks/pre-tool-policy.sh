#!/usr/bin/env bash

set -euo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
input="$(cat)"
tool_name="$(jq -r '.tool_name // ""' <<<"$input")"
command="$(jq -r '.tool_input.command // .tool_input.cmd // ""' <<<"$input")"

if [[ "$tool_name" != "Bash" || -z "$command" ]]; then
  exit 0
fi

block() {
  printf 'BLOCKED: %s\n' "$1" >&2
  exit 2
}

if grep -Eq '(^|[[:space:];|&])terraform[[:space:]][^;|&]*(init|plan|apply|destroy|import|state|output|refresh)([[:space:];|&]|$)' <<<"$command"; then
  if ! grep -Eq 'STORAGE_EMULATOR_HOST=[[:space:]]' <<<"$command" ||
    ! grep -Eq 'FIRESTORE_EMULATOR_HOST=[[:space:]]' <<<"$command" ||
    ! grep -Eq 'PUBSUB_EMULATOR_HOST=[[:space:]]' <<<"$command"; then
    block "Terraform requires STORAGE_EMULATOR_HOST=, FIRESTORE_EMULATOR_HOST=, and PUBSUB_EMULATOR_HOST= before the command. Run it from ${repo_root}."
  fi
fi

if grep -Eq '(^|[[:space:];|&])gsutil[[:space:]][^;|&]*mb([[:space:];|&]|$)' <<<"$command" ||
  grep -Eq '(^|[[:space:];|&])gcloud[[:space:]][^;|&]*pubsub[[:space:]][^;|&]*(topics|subscriptions)[[:space:]][^;|&]*create([[:space:];|&]|$)' <<<"$command" ||
  grep -Eq '(^|[[:space:];|&])gcloud[[:space:]][^;|&]*run[[:space:]][^;|&]*(deploy|services[[:space:]][^;|&]*update)([[:space:];|&]|$)' <<<"$command" ||
  grep -Eq '(^|[[:space:];|&])gcloud[[:space:]][^;|&]*secrets[[:space:]][^;|&]*create([[:space:];|&]|$)' <<<"$command" ||
  grep -Eq '(^|[[:space:];|&])gcloud[[:space:]][^;|&]*sql[[:space:]][^;|&]*instances[[:space:]][^;|&]*create([[:space:];|&]|$)' <<<"$command" ||
  grep -Eq '(^|[[:space:];|&])gcloud[[:space:]][^;|&]*compute[[:space:]][^;|&]*instances[[:space:]][^;|&]*create([[:space:];|&]|$)' <<<"$command" ||
  grep -Eq '(^|[[:space:];|&])gcloud[[:space:]][^;|&]*iam[[:space:]][^;|&]*service-accounts[[:space:]][^;|&]*create([[:space:];|&]|$)' <<<"$command"; then
  block "Persistent infrastructure must be managed through Terraform in ${repo_root}/terraform."
fi

exit 0
