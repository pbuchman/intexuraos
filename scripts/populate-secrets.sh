#!/usr/bin/env bash
# populate-secrets.sh - Interactive script to populate GCP Secret Manager secrets
#
# Two modes:
# 1) Default mode (Terraform-driven):
#    - Extracts secret names from Terraform configuration and prompts for values.
#
# 2) --new mode (GCP-driven):
#    - Fetches all secrets in the current GCP project that have NO versions
#      and prompts to populate them.
#
# Usage:
#   ./scripts/populate-secrets.sh [environment]
#   ./scripts/populate-secrets.sh --new
#   ./scripts/populate-secrets.sh --new [environment]   # env is optional; used only for header/logging
#
#   environment: dev (default), staging, prod
#
# Prerequisites:
#   - gcloud CLI installed and authenticated
#   - Project configured: gcloud config set project <PROJECT_ID>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

MODE="terraform"
ENVIRONMENT="dev"

usage() {
    cat <<EOF
Usage:
  $(basename "$0") [environment]
  $(basename "$0") --new [environment]

Modes:
  default (Terraform-driven): extracts secrets from terraform/environments/<env>/main.tf
  --new (GCP-driven): prompts for all existing secrets in Secret Manager that have NO versions

Examples:
  $(basename "$0") dev
  $(basename "$0") --new
  $(basename "$0") --new prod
EOF
}

# -----------------------------
# Arg parsing
# -----------------------------
while [[ $# -gt 0 ]]; do
    case "$1" in
        --new)
            MODE="new"
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            # first non-flag is environment
            ENVIRONMENT="$1"
            shift
            ;;
    esac
done

TF_DIR="${REPO_ROOT}/terraform/environments/${ENVIRONMENT}"

# Extract secret names from Terraform main.tf
# Pattern: "INTEXURAOS_*" = "description"
extract_secrets_from_terraform() {
    grep -E '"INTEXURAOS_[A-Z0-9_]+"' "${TF_DIR}/main.tf" | \
        sed -E 's/.*"(INTEXURAOS_[A-Z0-9_]+)".*/\1/' | \
        sort -u
}

# Get secret description from Terraform
get_description_from_terraform() {
    local secret_name="$1"
    grep -E "\"${secret_name}\"" "${TF_DIR}/main.tf" | \
        sed -E 's/.*= "(.*)"/\1/' | head -1
}

# Fetch all secrets that have NO versions in the current project
extract_secrets_without_versions_from_gcp() {
    # List all secret names, then filter those with zero versions
    local names
    names="$(gcloud secrets list --format="value(name)" 2>/dev/null || true)"
    if [[ -z "$names" ]]; then
        return 0
    fi

    while IFS= read -r secret_name; do
        [[ -z "$secret_name" ]] && continue
        if ! secret_has_version "$secret_name"; then
            echo "$secret_name"
        fi
    done <<< "$names" | sort -u
}

# Get secret description from GCP (labels/description may be empty)
get_description_from_gcp() {
    local secret_name="$1"
    gcloud secrets describe "$secret_name" --format="value(replication.automatic)" >/dev/null 2>&1 || true
    gcloud secrets describe "$secret_name" --format="value(labels)" 2>/dev/null || true
}

# Check if secret exists in GCP
secret_exists() {
    local secret_name="$1"
    gcloud secrets describe "$secret_name" --quiet >/dev/null 2>&1
}

# Check if secret has a version (value set)
secret_has_version() {
    local secret_name="$1"
    gcloud secrets versions list "$secret_name" --limit=1 --format="value(name)" 2>/dev/null | grep -q .
}

# Add value to secret
add_secret_value() {
    local secret_name="$1"
    local value="$2"
    echo -n "$value" | gcloud secrets versions add "$secret_name" --data-file=-
}

# Get latest secret value (may fail due to permissions; caller decides how to handle)
get_latest_secret_value() {
    local secret_name="$1"
    gcloud secrets versions access latest --secret "$secret_name" 2>/dev/null
}

echo "============================================"
echo "IntexuraOS Secret Manager Population Script"
echo "============================================"
echo ""
echo "Mode:        ${MODE}"
echo "Environment: ${ENVIRONMENT}"
if [[ "$MODE" == "terraform" ]]; then
    echo "Terraform:   ${TF_DIR}"
fi
echo ""

# Verify gcloud is configured
PROJECT_ID=$(gcloud config get-value project 2>/dev/null || true)
if [[ -z "$PROJECT_ID" ]]; then
    echo "Error: No GCP project configured." >&2
    echo "Run: gcloud config set project <PROJECT_ID>" >&2
    exit 1
fi
echo "GCP Project: ${PROJECT_ID}"
echo ""

# Extract secrets
if [[ "$MODE" == "terraform" ]]; then
    if [[ ! -d "$TF_DIR" ]]; then
        echo "Error: Terraform environment not found: ${TF_DIR}" >&2
        exit 1
    fi
    if [[ ! -f "${TF_DIR}/main.tf" ]]; then
        echo "Error: Terraform file not found: ${TF_DIR}/main.tf" >&2
        exit 1
    fi

    SECRETS=$(extract_secrets_from_terraform || true)
    if [[ -z "${SECRETS}" ]]; then
        echo "Error: No secrets found in Terraform configuration." >&2
        exit 1
    fi
else
    SECRETS=$(extract_secrets_without_versions_from_gcp || true)
    if [[ -z "${SECRETS}" ]]; then
        echo "No secrets without versions found in GCP Secret Manager."
        exit 0
    fi
fi

SECRET_COUNT=$(echo "$SECRETS" | wc -l | tr -d ' ')
if [[ "$MODE" == "terraform" ]]; then
    echo "Found ${SECRET_COUNT} secrets to populate (from Terraform)."
else
    echo "Found ${SECRET_COUNT} secrets to populate (secrets with NO versions in GCP)."
fi
echo ""

# Store values for final output
declare -A SECRET_VALUES

# Process each secret
for SECRET_NAME in $SECRETS; do
    DESCRIPTION=""
    if [[ "$MODE" == "terraform" ]]; then
        DESCRIPTION=$(get_description_from_terraform "$SECRET_NAME" || true)
    else
        # Best-effort only; secrets may not have labels/description
        DESCRIPTION=$(get_description_from_gcp "$SECRET_NAME" || true)
    fi

    echo "----------------------------------------"
    echo "Secret: ${SECRET_NAME}"
    if [[ -n "$DESCRIPTION" ]]; then
        echo "Description: ${DESCRIPTION}"
    else
        echo "Description: <none>"
    fi

    # Check if secret exists
    if ! secret_exists "$SECRET_NAME"; then
        echo "Warning: Secret does not exist in GCP." >&2
        if [[ "$MODE" == "terraform" ]]; then
            echo "Run 'terraform apply' first." >&2
        fi
        echo "Skipping..."
        echo ""
        continue
    fi

    # Check if already has a value
    if secret_has_version "$SECRET_NAME"; then
        echo "Status: Already has a value"

        CURRENT_VALUE=$(get_latest_secret_value "$SECRET_NAME" || true)
        if [[ -z "$CURRENT_VALUE" ]]; then
            echo "Current value: <unable to read (no access or empty)>"
        else
            echo "Current value: ${CURRENT_VALUE}"
        fi

        read -rp "Overwrite? [y/N]: " OVERWRITE
        if [[ ! "$OVERWRITE" =~ ^[Yy]$ ]]; then
            echo "Skipping..."
            echo ""
            continue
        fi
    else
        echo "Status: No versions found (new/empty secret)"
    fi

    # Prompt for value
    # Use -s for sensitive data
    if [[ "$SECRET_NAME" == *"TOKEN"* ]] || [[ "$SECRET_NAME" == *"SECRET"* ]] || [[ "$SECRET_NAME" == *"KEY"* ]]; then
        read -rsp "Enter value (hidden): " VALUE
        echo ""
    else
        read -rp "Enter value: " VALUE
    fi

    if [[ -z "$VALUE" ]]; then
        echo "Empty value - skipping..."
        echo ""
        continue
    fi

    # Add secret value
    if add_secret_value "$SECRET_NAME" "$VALUE"; then
        echo "✓ Secret value added successfully"
        SECRET_VALUES["$SECRET_NAME"]="$VALUE"
    else
        echo "✗ Failed to add secret value" >&2
    fi
    echo ""
done

echo ""
echo "============================================"
echo "SECRET POPULATION COMPLETE"
echo "============================================"
echo ""

if [[ ${#SECRET_VALUES[@]} -gt 0 ]]; then
    echo "The following secrets were populated:"
    echo ""
    echo "----------------------------------------"
    echo "SAVE THIS OUTPUT - values won't be shown again!"
    echo "----------------------------------------"
    echo ""
    for SECRET_NAME in $(echo "${!SECRET_VALUES[@]}" | tr ' ' '\n' | sort); do
        echo "${SECRET_NAME}=${SECRET_VALUES[$SECRET_NAME]}"
    done
    echo ""
    echo "----------------------------------------"
    echo ""
    echo "Tip: Save these values in a secure password manager."
else
    echo "No secrets were populated."
fi

echo ""
echo "To verify secrets, run:"
echo "  gcloud secrets versions list <SECRET_NAME>"
echo ""
