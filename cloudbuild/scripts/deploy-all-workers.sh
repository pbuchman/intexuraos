#!/usr/bin/env bash
# deploy-all-workers.sh - Deploy all Cloud Function workers
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

WORKERS=(transcription)

log "Deploying all Cloud Function workers..."

for worker in "${WORKERS[@]}"; do
  log "Deploying worker: $worker"
  bash "${SCRIPT_DIR}/deploy-function.sh" "$worker"
done

log "All workers deployed successfully"
