#!/usr/bin/env bash
# deploy-function.sh - Deploy a Cloud Function worker to GCS and redeploy functions
#
# This script packages and uploads a Cloud Function worker to GCS,
# then redeploys all Cloud Functions that use that worker's source.
#
# Usage:
#   ./cloudbuild/scripts/deploy-function.sh <worker-name>
#
# Required environment variables:
#   REGION - GCP region
#   ENVIRONMENT - Environment name (dev, prod)
#   FUNCTIONS_SOURCE_BUCKET - GCS bucket for function source code

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

WORKER="$1"
require_env_vars REGION ENVIRONMENT FUNCTIONS_SOURCE_BUCKET

WORKER_DIR="/workspace/workers/${WORKER}"

log "Deploying Cloud Function worker: ${WORKER}"

if [[ ! -d "${WORKER_DIR}" ]]; then
  log "ERROR: Worker directory not found: ${WORKER_DIR}"
  exit 1
fi

if [[ ! -d "${WORKER_DIR}/dist" ]]; then
  log "ERROR: Build output not found: ${WORKER_DIR}/dist"
  exit 1
fi

log "Generating production package.json..."
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('${WORKER_DIR}/package.json', 'utf-8'));
  const prod = {
    name: pkg.name.replace('@intexuraos/', '') + '-prod',
    version: '1.0.0',
    type: 'module',
    main: 'index.js',
    dependencies: pkg.dependencies || {}
  };
  fs.writeFileSync('${WORKER_DIR}/dist/package.json', JSON.stringify(prod, null, 2));
"

log "Creating function.zip..."
cd "${WORKER_DIR}/dist"
rm -f function.zip
zip -r function.zip .

DEST_PATH="gs://${FUNCTIONS_SOURCE_BUCKET}/${WORKER}/function.zip"
log "Uploading to ${DEST_PATH}..."
gsutil cp function.zip "${DEST_PATH}"

log "Source uploaded to: ${DEST_PATH}"

# Redeploy Cloud Functions that use this worker's source
log "Redeploying Cloud Functions for worker: ${WORKER}"

case "${WORKER}" in
  vm-lifecycle)
    FUNCTIONS=("intexuraos-vm-start-${ENVIRONMENT}" "intexuraos-vm-stop-${ENVIRONMENT}")
    ;;
  log-cleanup)
    FUNCTIONS=("intexuraos-log-cleanup-${ENVIRONMENT}")
    ;;
  *)
    log "WARNING: No function mapping found for worker: ${WORKER}"
    log "Source uploaded but functions not redeployed"
    exit 0
    ;;
esac

for FUNC in "${FUNCTIONS[@]}"; do
  log "Redeploying function: ${FUNC}"
  gcloud functions deploy "${FUNC}" \
    --region="${REGION}" \
    --source="${DEST_PATH}" \
    --gen2 \
    --quiet
done

log "Deployment complete for ${WORKER}"
