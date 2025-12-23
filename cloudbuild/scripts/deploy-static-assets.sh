#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=cloudbuild/scripts/lib.sh
source "${SCRIPT_DIR}/lib.sh"

require_env_vars ENVIRONMENT

BUCKET="praxos-static-assets-${ENVIRONMENT}"

log "Syncing static assets"
log "  Bucket: ${BUCKET}"
log "  Source: docs/assets/"

gsutil -m rsync -r -d docs/assets/ "gs://${BUCKET}/"

log "Static assets sync complete"
