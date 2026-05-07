#!/usr/bin/env bash
# build-all-workers.sh - Build all Cloud Function workers
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

WORKERS=(vm-lifecycle transcription)

log "Building all Cloud Function workers..."

for worker in "${WORKERS[@]}"; do
  log "Building worker: $worker"

  # Build with pnpm
  pnpm --filter "@intexuraos/$worker" build

  # Generate production package.json
  WORKER_DIR="${WORKSPACE_ROOT:-/workspace}/workers/${worker}"

  if [[ ! -d "${WORKER_DIR}/dist" ]]; then
    log "ERROR: Build output not found: ${WORKER_DIR}/dist"
    exit 1
  fi

  # Check if build-service.mjs already created package.json (esbuild builds)
  if [[ -f "${WORKER_DIR}/dist/package.json" ]]; then
    log "Using package.json from build-service.mjs"
  else
    # Create minimal package.json for Cloud Functions (tsc builds without workspace deps)
    node -e "
      const fs = require('fs');
      const pkg = JSON.parse(fs.readFileSync('${WORKER_DIR}/package.json'));
      // Filter out workspace: dependencies - they should be bundled
      const deps = Object.fromEntries(
        Object.entries(pkg.dependencies || {}).filter(([k, v]) => !v.startsWith('workspace:'))
      );
      const prod = {
        name: pkg.name.replace('@intexuraos/', '') + '-prod',
        version: '1.0.0',
        type: 'module',
        main: 'index.js',
        dependencies: deps
      };
      fs.writeFileSync('${WORKER_DIR}/dist/package.json', JSON.stringify(prod, null, 2));
    "
  fi

  log "Built: $worker"
done

log "All workers built successfully"
