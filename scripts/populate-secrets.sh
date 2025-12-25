#!/usr/bin/env bash
# populate-secrets.sh - Interactive script to populate GCP Secret Manager secrets
# Extracts secret names from Terraform configuration and prompts for values.
#
# Usage: ./scripts/populate-secrets.sh [environment]
#   environment: dev (default), staging, prod
#
# Prerequisites:
#   - gcloud CLI installed and authenticated
#   - Project configured: gcloud config set project <PROJECT_ID>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Default environment
ENVIRONMENT="${1:-dev}"
TF_DIR="${REPO_ROOT}/terraform/environments/${ENVIRONMENT}"

if [[ ! -d "$TF_DIR" ]]; then
    echo "Error: Terraform environment not found: ${TF_DIR}" >&2
    exit 1
fi

# Extract secret names from Terraform main.tf
# Pattern: "INTEXURAOS_*" = "description"
extract_secrets() {
    grep -E '"INTEXURAOS_[A-Z0-9_]+"' "${TF_DIR}/main.tf" | \
        sed -E 's/.*"(INTEXURAOS_[A-Z0-9_]+)".*/\1/' | \
        sort -u
}

# Get secret description from Terraform
get_description() {
    local secret_name="$1"
    grep -E "\"${secret_name}\"" "${TF_DIR}/main.tf" | \
        sed -E 's/.*= "(.*)"/\1/' | head -1
}

# Check if secret exists in GCP
secret_exists() {
    local secret_name="$1"
    gcloud secrets describe "$secret_name" --quiet 2>/dev/null
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
echo "Environment: ${ENVIRONMENT}"
echo "Terraform:   ${TF_DIR}"
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
SECRETS=$(extract_secrets)
if [[ -z "$SECRETS" ]]; then
    echo "Error: No secrets found in Terraform configuration." >&2
    exit 1
fi

SECRET_COUNT=$(echo "$SECRETS" | wc -l | tr -d ' ')
echo "Found ${SECRET_COUNT} secrets to populate."
echo ""

# Store values for final output
declare -A SECRET_VALUES

# Process each secret
for SECRET_NAME in $SECRETS; do
    DESCRIPTION=$(get_description "$SECRET_NAME")

    echo "----------------------------------------"
    echo "Secret: ${SECRET_NAME}"
    echo "Description: ${DESCRIPTION}"

    # Check if secret exists
    if ! secret_exists "$SECRET_NAME"; then
        echo "Warning: Secret does not exist in GCP. Run 'terraform apply' first." >&2
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

