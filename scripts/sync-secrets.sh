#!/usr/bin/env bash
#
# Sync PRAXOS secrets from GCP Secret Manager to .envrc file.
#
# Prerequisites:
#   - gcloud CLI installed and authenticated
#   - PROJECT_ID environment variable set
#
# Usage:
#   export PROJECT_ID=praxos-dev-pbuchman
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
REGISTRY="${REGISTRY:-europe-central2-docker.pkg.dev/${PROJECT_ID}/praxos-dev}"

cat > "${ENVRC_FILE}" << EOF
export PROJECT_ID=${PROJECT_ID}
export REGION=${REGION}
export REGISTRY=${REGISTRY}
EOF

# Get all PRAXOS secrets and append to .envrc
for secret in $(gcloud secrets list --project="${PROJECT_ID}" --format="value(name)" | grep "^PRAXOS_"); do
  value=$(gcloud secrets versions access latest --secret="${secret}" --project="${PROJECT_ID}" 2>/dev/null || echo "")
  if [[ -n "$value" ]]; then
    echo "export ${secret}=${value}" >> "${ENVRC_FILE}"
  fi
done

echo "Updated ${ENVRC_FILE}"
