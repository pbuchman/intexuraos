#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=cloudbuild/scripts/lib.sh
source "${SCRIPT_DIR}/lib.sh"

SERVICE="web"

require_env_vars ENVIRONMENT

BUCKET="intexuraos-web-${ENVIRONMENT}"

log "Deploying ${SERVICE} assets"
log "  Bucket: ${BUCKET}"
log "  Source: apps/web/dist/"

# Sync all files with automatic content-type detection
gsutil -m rsync -r -d apps/web/dist/ "gs://${BUCKET}/"

# Set correct content-type for common web assets
gsutil -m setmeta -h "Content-Type:image/png" "gs://${BUCKET}/*.png" 2>/dev/null || true
gsutil -m setmeta -h "Content-Type:image/png" "gs://${BUCKET}/favicon.png" 2>/dev/null || true
gsutil -m setmeta -h "Content-Type:image/png" "gs://${BUCKET}/logo.png" 2>/dev/null || true

log "Deployment complete for ${SERVICE}"
