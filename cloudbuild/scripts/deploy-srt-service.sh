#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=cloudbuild/scripts/lib.sh
source "${SCRIPT_DIR}/lib.sh"

SERVICE="srt-service"
CLOUD_RUN_SERVICE="intexuraos-srt-service"

require_env_vars REGION ARTIFACT_REGISTRY_URL COMMIT_SHA

tag="$(deployment_tag)"
image="${ARTIFACT_REGISTRY_URL}/${SERVICE}:${tag}"

log "Deploying ${SERVICE} to Cloud Run"
log "  Environment: ${ENVIRONMENT:-unset}"
log "  Region: ${REGION}"
log "  Image: ${image}"

# srt-service is internal-only (no public access)
# IAM is managed by Terraform, so we use --no-allow-unauthenticated
gcloud run deploy "$CLOUD_RUN_SERVICE" \
  --image="$image" \
  --region="$REGION" \
  --platform=managed \
  --no-allow-unauthenticated \
  --quiet

log "Deployment complete for ${SERVICE}"

