#!/usr/bin/env bash
# Deploy Firestore indexes and security rules using Firebase CLI.
#
# Prerequisites:
# - Cloud Build service account needs Firebase Admin role
# - firebase.json must exist in repo root with firestore configuration
#
# Required environment variables:
# - PROJECT_ID: GCP project ID (provided by Cloud Build)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=cloudbuild/scripts/lib.sh
source "${SCRIPT_DIR}/lib.sh"

require_env_vars PROJECT_ID

log "Deploying Firestore indexes and rules"
log "  Project: ${PROJECT_ID}"

# Check required files exist
if [[ ! -f "firebase.json" ]]; then
  log "ERROR: firebase.json not found in repo root"
  exit 1
fi

if [[ ! -f "firestore.indexes.json" ]]; then
  log "ERROR: firestore.indexes.json not found in repo root"
  exit 1
fi

if [[ ! -f "firestore.rules" ]]; then
  log "ERROR: firestore.rules not found in repo root"
  exit 1
fi

# Deploy indexes and rules
log "Deploying Firestore indexes..."
npx firebase-tools deploy --only firestore:indexes --project="${PROJECT_ID}" --non-interactive

log "Deploying Firestore rules..."
npx firebase-tools deploy --only firestore:rules --project="${PROJECT_ID}" --non-interactive

log "Firestore deployment complete"
