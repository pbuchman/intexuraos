#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=cloudbuild/scripts/lib.sh
source "${SCRIPT_DIR}/lib.sh"

SERVICE="web"

require_env_vars ENVIRONMENT

BUCKET="praxos-web-${ENVIRONMENT}"

log "Deploying ${SERVICE} assets"
log "  Bucket: ${BUCKET}"
log "  Source: apps/web/dist/"

gsutil -m rsync -r -d apps/web/dist/ "gs://${BUCKET}/"

log "Deployment complete for ${SERVICE}" 
