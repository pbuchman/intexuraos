#!/usr/bin/env bash
# Deploy Firestore via database migrations.
#
# Runs pending migrations which handle:
# - Firestore indexes (firestore.indexes.json)
# - Firestore security rules (firestore.rules)
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

# Check required files exist for migrations that deploy indexes/rules
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

# Run migrations
log "Running pending migrations..."
node scripts/migrate.mjs --project "${PROJECT_ID}"

log "Firestore migrations complete"
