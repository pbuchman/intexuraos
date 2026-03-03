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
)

declare -a TERRAFORM_SECRETS=()
SECRET_MAP_FILE=""
PARALLEL_TEMP_DIR=""

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
  ${SCRIPT_NAME} [environment] [--add-new] [--project-id <project_id>] [--output <path>]

Modes:
  default        Non-interactive sync from GCP Secret Manager to .envrc
  --add-new      Sync + prompt for missing Terraform-defined secret values

Arguments:
  environment    Terraform environment name (default: ${DEFAULT_ENVIRONMENT})

Options:
  --add-new      Prompt for missing secret values (no overwrite flow)
  --project-id   Override GCP project ID
  --output       Override output file path (default: <repo>/.envrc)
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
  if [[ -n "${PARALLEL_TEMP_DIR}" && -d "${PARALLEL_TEMP_DIR}" ]]; then
    rm -rf "${PARALLEL_TEMP_DIR}"
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
    /module[[:space:]]+"secret_manager"[[:space:]]*[{]/ { in_module = 1; next }
    in_module && /secrets[[:space:]]*=[[:space:]]*[{]/ { in_secrets = 1; next }
    in_secrets && /^[[:space:]]*[}][[:space:]]*$/ { in_secrets = 0; in_module = 0; next }
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

_run_parallel_fetch() {
  local secrets_list_file="$1"

  if ! python3 - "${PROJECT_ID}" "${PARALLEL_TEMP_DIR}" "${secrets_list_file}" << 'PYTHON_FETCH'
import sys, json, base64, ssl, os
from concurrent.futures import ThreadPoolExecutor
from urllib.request import Request, urlopen
from subprocess import check_output

project_id, temp_dir, secrets_file = sys.argv[1], sys.argv[2], sys.argv[3]

ssl_ctx = ssl.create_default_context()
try:
    import certifi
    ssl_ctx.load_verify_locations(certifi.where())
except ImportError:
    ssl_ctx.check_hostname = False
    ssl_ctx.verify_mode = ssl.CERT_NONE

token = check_output(["gcloud", "auth", "print-access-token"], text=True).strip()
base_url = f"https://secretmanager.googleapis.com/v1/projects/{project_id}/secrets"
headers = {"Authorization": f"Bearer {token}"}

existing = set()
page_url = f"{base_url}?filter=name%3AINTEXURAOS_&pageSize=100"
while page_url:
    resp = json.loads(urlopen(Request(page_url, headers=headers), context=ssl_ctx).read())
    for s in resp.get("secrets", []):
        existing.add(s["name"].split("/")[-1])
    nxt = resp.get("nextPageToken")
    page_url = f"{base_url}?filter=name%3AINTEXURAOS_&pageSize=100&pageToken={nxt}" if nxt else None

with open(os.path.join(temp_dir, "_existing.txt"), "w") as f:
    f.write("\n".join(sorted(existing)))

with open(secrets_file) as f:
    to_check = [line.strip() for line in f if line.strip()]
to_fetch = [s for s in to_check if s in existing]

def fetch(name):
    url = f"{base_url}/{name}/versions/latest:access"
    try:
        data = json.loads(urlopen(Request(url, headers=headers), context=ssl_ctx).read())
        value = base64.b64decode(data["payload"]["data"]).decode()
        with open(os.path.join(temp_dir, f"{name}.status"), "w") as sf:
            sf.write("present")
        with open(os.path.join(temp_dir, f"{name}.value"), "w") as vf:
            vf.write(value)
    except Exception:
        try:
            list_url = f"{base_url}/{name}/versions?pageSize=1"
            list_data = json.loads(urlopen(Request(list_url, headers=headers), context=ssl_ctx).read())
            status = "missing-version" if not list_data.get("versions") else "unreadable"
        except Exception:
            status = "unreadable"
        with open(os.path.join(temp_dir, f"{name}.status"), "w") as sf:
            sf.write(status)

with ThreadPoolExecutor(max_workers=20) as pool:
    list(pool.map(fetch, to_fetch))

print(f"  Listed {len(existing)} secrets, fetched {len(to_fetch)} values")
PYTHON_FETCH
  then
    fail "Parallel fetch failed. Check python3, gcloud auth, and network."
  fi
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
[[ -f .envrc.local ]] && source .envrc.local || true
EOF
}

sync_and_classify() {
  local secret_name=""
  local secret_status=""
  local secret_value=""

  EXPORTED_SECRETS=()
  SKIPPED_NON_EXPORTABLE=()
  MISSING_SECRETS=()
  MISSING_VERSIONS=()
  UNREADABLE_SECRETS=()
  PROMPTABLE_MISSING=()
  MANUAL_MISSING=()

  write_envrc_header

  if [[ ${#TERRAFORM_SECRETS[@]} -eq 0 ]]; then
    append_envrc_footer
    return
  fi

  echo "Syncing Terraform-defined secrets..."

  PARALLEL_TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/sync-secrets-fetch.XXXXXX")"
  local secrets_list_file="${PARALLEL_TEMP_DIR}/_secrets_list.txt"
  printf '%s\n' "${TERRAFORM_SECRETS[@]}" > "${secrets_list_file}"

  _run_parallel_fetch "${secrets_list_file}"

  local existing_file="${PARALLEL_TEMP_DIR}/_existing.txt"

  for secret_name in "${TERRAFORM_SECRETS[@]}"; do
    if ! grep -qFx "${secret_name}" "${existing_file}" 2>/dev/null; then
      MISSING_SECRETS+=("${secret_name}")
      continue
    fi

    local status_file="${PARALLEL_TEMP_DIR}/${secret_name}.status"
    local value_file="${PARALLEL_TEMP_DIR}/${secret_name}.value"

    if [[ ! -f "${status_file}" ]]; then
      UNREADABLE_SECRETS+=("${secret_name}")
      continue
    fi

    secret_status="$(cat "${status_file}")"

    case "${secret_status}" in
      present)
        if is_non_exportable_secret "${secret_name}"; then
          SKIPPED_NON_EXPORTABLE+=("${secret_name}")
        elif [[ -f "${value_file}" ]]; then
          secret_value="$(cat "${value_file}")"
          printf 'export %s=%q\n' "${secret_name}" "${secret_value}" >> "${ENVRC_FILE}"
          EXPORTED_SECRETS+=("${secret_name}")
        else
          UNREADABLE_SECRETS+=("${secret_name}")
        fi
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
  done

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
      --output)
        shift
        [[ $# -gt 0 ]] || fail "--output requires a path"
        ENVRC_FILE="$1"
        shift
        ;;
      --output=*)
        ENVRC_FILE="${1#*=}"
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
  command -v python3 >/dev/null 2>&1 || fail "python3 is required for parallel secret fetching"
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
