#!/usr/bin/env bash
# sync-secrets.sh - Single entrypoint for local secret sync and missing-secret population.
#
# Modes:
#   1) Default (non-interactive):
#      - Syncs Terraform-defined INTEXURAOS_* secrets from GCP Secret Manager into .envrc
#      - Prints missing/unreadable secrets
#
#   2) --add-new (interactive):
#      - Runs default sync
#      - Prompts only for missing secret values (no overwrite flow)
#
# Usage:
#   ./scripts/sync-secrets.sh [environment] [--add-new] [--project-id <project_id>]
#
# Examples:
#   ./scripts/sync-secrets.sh
#   ./scripts/sync-secrets.sh dev
#   ./scripts/sync-secrets.sh dev --add-new
#   ./scripts/sync-secrets.sh --project-id intexuraos-dev-pbuchman --add-new

set -euo pipefail

SCRIPT_NAME="$(basename "$0")"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENVRC_FILE="${REPO_ROOT}/.envrc"

DEFAULT_ENVIRONMENT="dev"
ADD_NEW_MODE=0
ENVIRONMENT="${DEFAULT_ENVIRONMENT}"
CLI_PROJECT_ID=""
REGION_VALUE="${REGION:-europe-central2}"

NON_EXPORTABLE_SECRETS=(
  "INTEXURAOS_SSL_PRIVATE_KEY"
  "INTEXURAOS_GITHUB_APP_PRIVATE_KEY"
  "INTEXURAOS_PREDEV_ENV_VARS"
)

declare -a TERRAFORM_SECRETS=()
SECRET_MAP_FILE=""

declare -a EXPORTED_SECRETS=()
declare -a SKIPPED_NON_EXPORTABLE=()
declare -a MISSING_SECRETS=()
declare -a MISSING_VERSIONS=()
declare -a UNREADABLE_SECRETS=()
declare -a PROMPTABLE_MISSING=()
declare -a MANUAL_MISSING=()

declare -a ADDED_SECRETS=()
declare -a FAILED_ADDS=()
declare -a SKIPPED_INPUT=()

usage() {
  cat <<EOF
Usage:
  ${SCRIPT_NAME} [environment] [--add-new] [--project-id <project_id>]

Modes:
  default        Non-interactive sync from GCP Secret Manager to .envrc
  --add-new      Sync + prompt for missing Terraform-defined secret values

Arguments:
  environment    Terraform environment name (default: ${DEFAULT_ENVIRONMENT})

Options:
  --add-new      Prompt for missing secret values (no overwrite flow)
  --project-id   Override GCP project ID
  -h, --help     Show this help

Project ID resolution order:
  1) --project-id
  2) \$PROJECT_ID
  3) gcloud active project
EOF
}

fail() {
  echo "ERROR: $1" >&2
  exit 1
}

cleanup() {
  if [[ -n "${SECRET_MAP_FILE}" && -f "${SECRET_MAP_FILE}" ]]; then
    rm -f "${SECRET_MAP_FILE}"
  fi
}

trap cleanup EXIT

is_non_exportable_secret() {
  local secret_name="$1"
  local blocked
  for blocked in "${NON_EXPORTABLE_SECRETS[@]}"; do
    if [[ "${secret_name}" == "${blocked}" ]]; then
      return 0
    fi
  done
  return 1
}

is_sensitive_secret_name() {
  local secret_name="$1"
  [[ "${secret_name}" == *TOKEN* || "${secret_name}" == *SECRET* || "${secret_name}" == *KEY* ]]
}

extract_terraform_secret_entries() {
  local tf_file="$1"

  awk '
    /module[[:space:]]+"secret_manager"[[:space:]]*{/ { in_module = 1; next }
    in_module && /secrets[[:space:]]*=[[:space:]]*{/ { in_secrets = 1; next }
    in_secrets && /^[[:space:]]*}[[:space:]]*$/ { in_secrets = 0; in_module = 0; next }
    in_secrets {
      # Use quote splitting for macOS awk compatibility (no gawk-only match() array arg).
      quote_count = split($0, parts, "\"")
      if (quote_count >= 4 && parts[2] ~ /^INTEXURAOS_[A-Z0-9_]+$/ && parts[3] ~ /^[[:space:]]*=[[:space:]]*$/) {
        print parts[2] "\t" parts[4]
      }
    }
  ' "${tf_file}"
}

load_terraform_secret_map() {
  local tf_file="$1"
  local temp_map_file

  temp_map_file="$(mktemp "${TMPDIR:-/tmp}/sync-secrets-map.XXXXXX")"
  extract_terraform_secret_entries "${tf_file}" | sort -u > "${temp_map_file}"

  if [[ ! -s "${temp_map_file}" ]]; then
    rm -f "${temp_map_file}"
    fail "No INTEXURAOS_* secrets found in ${tf_file}"
  fi

  if [[ -n "${SECRET_MAP_FILE}" && -f "${SECRET_MAP_FILE}" ]]; then
    rm -f "${SECRET_MAP_FILE}"
  fi
  SECRET_MAP_FILE="${temp_map_file}"

  TERRAFORM_SECRETS=()
  while IFS=$'\t' read -r key description; do
    if [[ -z "${key}" ]]; then
      continue
    fi
    TERRAFORM_SECRETS+=("${key}")
  done < "${SECRET_MAP_FILE}"
}

get_secret_description() {
  local secret_name="$1"
  local description=""

  if [[ -n "${SECRET_MAP_FILE}" && -f "${SECRET_MAP_FILE}" ]]; then
    description="$(awk -F $'\t' -v key="${secret_name}" '$1 == key { print $2; exit }' "${SECRET_MAP_FILE}")"
  fi

  if [[ -z "${description}" ]]; then
    description="<no description>"
  fi

  printf '%s' "${description}"
}

secret_exists() {
  local secret_name="$1"
  gcloud secrets describe "${secret_name}" --project="${PROJECT_ID}" --quiet >/dev/null 2>&1
}

secret_has_version() {
  local secret_name="$1"
  local listed_versions=""
  if ! listed_versions="$(
    gcloud secrets versions list "${secret_name}" \
      --project="${PROJECT_ID}" \
      --limit=1 \
      --format="value(name)" 2>/dev/null
  )"; then
    return 2
  fi

  if [[ -n "${listed_versions}" ]]; then
    return 0
  fi

  return 1
}

get_secret_status() {
  local secret_name="$1"

  if ! secret_exists "${secret_name}"; then
    echo "missing-secret"
    return 0
  fi

  if secret_has_version "${secret_name}"; then
    echo "present"
    return 0
  fi

  local version_result=$?
  if [[ ${version_result} -eq 1 ]]; then
    echo "missing-version"
    return 0
  fi

  echo "unreadable"
}

read_latest_secret_value() {
  local secret_name="$1"
  gcloud secrets versions access latest \
    --secret="${secret_name}" \
    --project="${PROJECT_ID}" 2>/dev/null
}

add_secret_value() {
  local secret_name="$1"
  local secret_value="$2"
  printf '%s' "${secret_value}" | gcloud secrets versions add "${secret_name}" \
    --project="${PROJECT_ID}" \
    --data-file=- >/dev/null
}

write_envrc_header() {
  local registry_value="${REGISTRY:-${REGION_VALUE}-docker.pkg.dev/${PROJECT_ID}/intexuraos-dev}"
  cat > "${ENVRC_FILE}" <<EOF
export PROJECT_ID=${PROJECT_ID}
export REGION=${REGION_VALUE}
export REGISTRY=${registry_value}
EOF
}

append_envrc_footer() {
  cat >> "${ENVRC_FILE}" <<'EOF'

# === LOCAL OVERRIDES ===
# Load .envrc.local if exists (for local dev overrides)
[[ -f .envrc.local ]] && source .envrc.local
EOF
}

print_sync_progress() {
  local current="$1"
  local total="$2"

  if [[ "${total}" -le 0 ]]; then
    return
  fi

  if [[ -t 1 ]]; then
    printf '\rSync progress: %d/%d' "${current}" "${total}"
    return
  fi

  if [[ "${current}" -eq 1 || $(( current % 10 )) -eq 0 || "${current}" -eq "${total}" ]]; then
    echo "Sync progress: ${current}/${total}"
  fi
}

finish_sync_progress() {
  local total="$1"

  if [[ "${total}" -le 0 ]]; then
    return
  fi

  if [[ -t 1 ]]; then
    printf '\rSync progress: %d/%d\n' "${total}" "${total}"
  fi
}

sync_and_classify() {
  local secret_name=""
  local secret_status=""
  local secret_value=""
  local total_secrets=0
  local processed_secrets=0

  EXPORTED_SECRETS=()
  SKIPPED_NON_EXPORTABLE=()
  MISSING_SECRETS=()
  MISSING_VERSIONS=()
  UNREADABLE_SECRETS=()
  PROMPTABLE_MISSING=()
  MANUAL_MISSING=()

  write_envrc_header

  total_secrets=${#TERRAFORM_SECRETS[@]}
  if [[ "${total_secrets}" -gt 0 ]]; then
    echo "Syncing Terraform-defined secrets..."
  fi

  for secret_name in "${TERRAFORM_SECRETS[@]}"; do
    processed_secrets=$((processed_secrets + 1))
    secret_status="$(get_secret_status "${secret_name}")"

    case "${secret_status}" in
      present)
        if is_non_exportable_secret "${secret_name}"; then
          SKIPPED_NON_EXPORTABLE+=("${secret_name}")
        elif ! secret_value="$(read_latest_secret_value "${secret_name}")"; then
          UNREADABLE_SECRETS+=("${secret_name}")
        else
          printf 'export %s=%q\n' "${secret_name}" "${secret_value}" >> "${ENVRC_FILE}"
          EXPORTED_SECRETS+=("${secret_name}")
        fi
        ;;
      missing-secret)
        MISSING_SECRETS+=("${secret_name}")
        ;;
      missing-version)
        MISSING_VERSIONS+=("${secret_name}")
        if is_non_exportable_secret "${secret_name}"; then
          MANUAL_MISSING+=("${secret_name}")
        else
          PROMPTABLE_MISSING+=("${secret_name}")
        fi
        ;;
      unreadable)
        UNREADABLE_SECRETS+=("${secret_name}")
        ;;
    esac

    print_sync_progress "${processed_secrets}" "${total_secrets}"
  done

  finish_sync_progress "${total_secrets}"
  append_envrc_footer
}

print_secret_list() {
  local heading="$1"
  shift
  local items=("$@")

  if [[ ${#items[@]} -eq 0 ]]; then
    return
  fi

  echo "${heading}"
  local item=""
  for item in "${items[@]}"; do
    echo "  - ${item}"
  done
  echo ""
}

print_sync_summary() {
  echo "============================================"
  echo "IntexuraOS Secrets Sync"
  echo "============================================"
  echo "Project:      ${PROJECT_ID}"
  echo "Environment:  ${ENVIRONMENT}"
  echo "Mode:         $([[ ${ADD_NEW_MODE} -eq 1 ]] && echo "sync + add-new" || echo "sync-only")"
  echo "Output file:  ${ENVRC_FILE}"
  echo ""
  echo "Terraform-defined secrets: ${#TERRAFORM_SECRETS[@]}"
  echo "Exported to .envrc:        ${#EXPORTED_SECRETS[@]}"
  echo "Skipped (non-exportable):  ${#SKIPPED_NON_EXPORTABLE[@]}"
  echo ""
}

prompt_for_missing_versions() {
  local secret_name=""
  local description=""
  local value=""

  if [[ ${#PROMPTABLE_MISSING[@]} -eq 0 ]]; then
    echo "No promptable missing secrets found."
    echo ""
    return
  fi

  echo "Interactive add-new: prompting for missing secret values"
  echo ""

  for secret_name in "${PROMPTABLE_MISSING[@]}"; do
    description="$(get_secret_description "${secret_name}")"
    echo "Secret: ${secret_name}"
    echo "Description: ${description}"

    if is_sensitive_secret_name "${secret_name}"; then
      read -rsp "Enter value (hidden, leave blank to skip): " value
      echo ""
    else
      read -rp "Enter value (leave blank to skip): " value
    fi

    if [[ -z "${value}" ]]; then
      SKIPPED_INPUT+=("${secret_name}")
      echo "Skipped."
      echo ""
      continue
    fi

    if add_secret_value "${secret_name}" "${value}"; then
      ADDED_SECRETS+=("${secret_name}")
      echo "Added new secret version."
    else
      FAILED_ADDS+=("${secret_name}")
      echo "Failed to add secret version."
    fi
    echo ""
  done
}

print_add_new_summary() {
  if [[ ${ADD_NEW_MODE} -eq 0 ]]; then
    return
  fi

  echo "Add-new summary:"
  echo "  Added:   ${#ADDED_SECRETS[@]}"
  echo "  Failed:  ${#FAILED_ADDS[@]}"
  echo "  Skipped: ${#SKIPPED_INPUT[@]}"
  echo ""

  print_secret_list "Added versions:" "${ADDED_SECRETS[@]}"
  print_secret_list "Failed adds:" "${FAILED_ADDS[@]}"
  print_secret_list "Skipped during prompt:" "${SKIPPED_INPUT[@]}"
}

print_missing_report() {
  echo "Missing/blocked secrets report:"
  echo ""

  print_secret_list "Missing secret resources (run terraform apply):" "${MISSING_SECRETS[@]}"
  print_secret_list "Missing secret values (no versions):" "${MISSING_VERSIONS[@]}"
  print_secret_list "Unreadable secrets (check gcloud auth/permissions):" "${UNREADABLE_SECRETS[@]}"

  if [[ ${#MANUAL_MISSING[@]} -gt 0 ]]; then
    echo "Manual population required for non-exportable secrets:"
    local secret_name=""
    for secret_name in "${MANUAL_MISSING[@]}"; do
      echo "  - ${secret_name}"
    done
    echo ""
  fi

  local issue_count=0
  issue_count=$(( ${#MISSING_SECRETS[@]} + ${#MISSING_VERSIONS[@]} + ${#UNREADABLE_SECRETS[@]} ))

  if [[ ${issue_count} -eq 0 ]]; then
    echo "All Terraform-defined secrets are available and readable."
  else
    echo "Found ${issue_count} unresolved secret issue(s)."
  fi

  echo ""
  echo "Updated ${ENVRC_FILE}"
}

resolve_project_id() {
  local resolved=""

  if [[ -n "${CLI_PROJECT_ID}" ]]; then
    resolved="${CLI_PROJECT_ID}"
  elif [[ -n "${PROJECT_ID:-}" ]]; then
    resolved="${PROJECT_ID}"
  else
    resolved="$(gcloud config get-value project 2>/dev/null || true)"
  fi

  if [[ -z "${resolved}" || "${resolved}" == "(unset)" ]]; then
    fail "Could not resolve project ID. Set --project-id, \$PROJECT_ID, or run 'gcloud config set project <PROJECT_ID>'."
  fi

  PROJECT_ID="${resolved}"
}

parse_args() {
  local environment_set=0

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --add-new)
        ADD_NEW_MODE=1
        shift
        ;;
      --project-id)
        shift
        [[ $# -gt 0 ]] || fail "--project-id requires a value"
        CLI_PROJECT_ID="$1"
        shift
        ;;
      --project-id=*)
        CLI_PROJECT_ID="${1#*=}"
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      --*)
        fail "Unknown option: $1"
        ;;
      *)
        if [[ ${environment_set} -eq 1 ]]; then
          fail "Unexpected positional argument: $1"
        fi
        ENVIRONMENT="$1"
        environment_set=1
        shift
        ;;
    esac
  done
}

main() {
  parse_args "$@"

  command -v gcloud >/dev/null 2>&1 || fail "gcloud CLI is not installed or not in PATH"
  resolve_project_id

  local tf_file="${REPO_ROOT}/terraform/environments/${ENVIRONMENT}/main.tf"
  [[ -f "${tf_file}" ]] || fail "Terraform file not found: ${tf_file}"

  load_terraform_secret_map "${tf_file}"
  sync_and_classify
  print_sync_summary
  print_missing_report

  if [[ ${ADD_NEW_MODE} -eq 1 ]]; then
    prompt_for_missing_versions
    if [[ ${#ADDED_SECRETS[@]} -gt 0 ]]; then
      sync_and_classify
    fi
    print_add_new_summary
    print_missing_report
  fi

  local unresolved=0
  unresolved=$(( ${#MISSING_SECRETS[@]} + ${#MISSING_VERSIONS[@]} + ${#UNREADABLE_SECRETS[@]} ))
  if [[ ${unresolved} -gt 0 ]]; then
    exit 2
  fi
}

main "$@"
