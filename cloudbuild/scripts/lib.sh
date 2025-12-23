#!/usr/bin/env bash
# Shared helpers for Cloud Build deployment scripts.

set -euo pipefail

log() {
  printf '[%s] %s\n' "$(date -Iseconds)" "$*"
}

require_env_vars() {
  local missing=()
  for var in "$@"; do
    if [[ -z "${!var:-}" ]]; then
      missing+=("$var")
    fi
  done

  if [[ ${#missing[@]} -gt 0 ]]; then
    printf 'Missing required environment variables:\n' >&2
    for var in "${missing[@]}"; do
      printf '  - %s\n' "$var" >&2
    done
    exit 1
  fi
}

deployment_tag() {
  if [[ "${FORCE_DEPLOY:-false}" == "true" ]]; then
    echo "latest"
  else
    echo "${COMMIT_SHA}"
  fi
}
