#!/usr/bin/env bash
# Deploy Firestore via database migrations.
#
# Runs pending migrations which handle:
# - Firestore indexes (generated from migrations/*.mjs)
# - Firestore security rules (generated from migrations/*.mjs)
# - Data migrations (app_settings, etc.)
#
# Prerequisites:
# - Cloud Build service account needs Firebase Admin role
# - npm ci must have been run
#
# Required environment variables:
# - PROJECT_ID: GCP project ID (provided by Cloud Build)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=cloudbuild/scripts/lib.sh
source "${SCRIPT_DIR}/lib.sh"

require_env_vars PROJECT_ID

log "Running Firestore migrations"
log "  Project: ${PROJECT_ID}"

if [[ ! -f "firebase.json" ]]; then
  log "ERROR: firebase.json not found in repo root"
  exit 1
fi

# Run migrations (generates firestore.indexes.json and firestore.rules from migrations/*.mjs)
log "Running pending migrations..."
node scripts/migrate.mjs --project "${PROJECT_ID}"

log "Firestore migrations complete"
