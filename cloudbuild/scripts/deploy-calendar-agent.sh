#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=cloudbuild/scripts/lib.sh
source "${SCRIPT_DIR}/lib.sh"

SERVICE="calendar-agent"
CLOUD_RUN_SERVICE="intexuraos-calendar-agent"

require_env_vars REGION ARTIFACT_REGISTRY_URL COMMIT_SHA

tag="$(deployment_tag)"
image="${ARTIFACT_REGISTRY_URL}/${SERVICE}:${tag}"

log "Deploying ${SERVICE} to Cloud Run"
log "  Environment: ${ENVIRONMENT:-unset}"
log "  Region: ${REGION}"
log "  Image: ${image}"

# Check if service exists (must be created by Terraform first)
if ! gcloud run services describe "$CLOUD_RUN_SERVICE" --region="$REGION" &>/dev/null; then
  log "ERROR: Service ${CLOUD_RUN_SERVICE} does not exist"
  log "Run 'terraform apply' in terraform/environments/dev/ first to create the service with proper configuration"
  exit 1
fi

gcloud run deploy "$CLOUD_RUN_SERVICE" \
  --image="$image" \
  --region="$REGION" \
  --platform=managed \
  --cpu-throttling \
  --quiet

log "Deployment complete for ${SERVICE}"
