#!/usr/bin/env bash
# build-all-workers.sh - Build all Cloud Function workers
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

WORKERS=(vm-lifecycle log-cleanup predev-lifecycle)

log "Building all Cloud Function workers..."

for worker in "${WORKERS[@]}"; do
  log "Building worker: $worker"

  # Build with pnpm
  pnpm --filter "@intexuraos/$worker" build

  # Generate production package.json
  WORKER_DIR="/workspace/workers/${worker}"

  if [[ ! -d "${WORKER_DIR}/dist" ]]; then
    log "ERROR: Build output not found: ${WORKER_DIR}/dist"
    exit 1
  fi

  # Create minimal package.json for Cloud Functions
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('${WORKER_DIR}/package.json'));
    const prod = {
      name: pkg.name.replace('@intexuraos/', '') + '-prod',
      version: '1.0.0',
      type: 'module',
      main: 'index.js',
      dependencies: pkg.dependencies || {}
    };
    fs.writeFileSync('${WORKER_DIR}/dist/package.json', JSON.stringify(prod, null, 2));
  "

  log "Built: $worker"
done

log "All workers built successfully"
