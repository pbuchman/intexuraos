#!/usr/bin/env bash
#
# Sync INTEXURAOS secrets from GCP Secret Manager to .envrc file.
#
# Prerequisites:
#   - gcloud CLI installed and authenticated
#   - PROJECT_ID environment variable set
#
# Usage:
#   export PROJECT_ID=intexuraos-dev-pbuchman
#   ./scripts/sync-secrets.sh
#

set -euo pipefail

if [[ -z "${PROJECT_ID:-}" ]]; then
  echo "ERROR: PROJECT_ID is not set"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENVRC_FILE="${SCRIPT_DIR}/../.envrc"

# Static variables (not from Secret Manager)
REGION="${REGION:-europe-central2}"
REGISTRY="${REGISTRY:-europe-central2-docker.pkg.dev/${PROJECT_ID}/intexuraos-dev}"

cat > "${ENVRC_FILE}" << EOF
export PROJECT_ID=${PROJECT_ID}
export REGION=${REGION}
export REGISTRY=${REGISTRY}
EOF

# Get all INTEXURAOS secrets and append to .envrc
# Skip SSL_PRIVATE_KEY - not needed locally and causes issues with multiline values
for secret in $(gcloud secrets list --project="${PROJECT_ID}" --format="value(name)" | grep "^INTEXURAOS_" | grep -v "SSL_PRIVATE_KEY"); do
  value=$(gcloud secrets versions access latest --secret="${secret}" --project="${PROJECT_ID}" 2>/dev/null || echo "")
  if [[ -n "$value" ]]; then
    echo "export ${secret}=${value}" >> "${ENVRC_FILE}"
  fi
done

# Add local overrides support
cat >> "${ENVRC_FILE}" << 'EOF'

# === LOCAL OVERRIDES ===
# Load .envrc.local if exists (for local dev overrides)
[[ -f .envrc.local ]] && source .envrc.local
EOF

echo "Updated ${ENVRC_FILE}"
