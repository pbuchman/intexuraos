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

# Set cache-control headers:
# - index.html: never cache (always fetch fresh to get new asset references)
# - Assets in /assets/: cache forever (filenames include content hash)
log "Setting cache-control headers..."

# index.html - no caching
gsutil setmeta -h "Cache-Control:no-cache, no-store, must-revalidate" \
  -h "Content-Type:text/html; charset=utf-8" \
  "gs://${BUCKET}/index.html"

# Hashed assets (JS/CSS) - cache for 1 year (immutable due to content hash in filename)
gsutil -m setmeta -h "Cache-Control:public, max-age=31536000, immutable" \
  "gs://${BUCKET}/assets/*.js" 2>/dev/null || true
gsutil -m setmeta -h "Cache-Control:public, max-age=31536000, immutable" \
  "gs://${BUCKET}/assets/*.css" 2>/dev/null || true

# Set correct content-type for common web assets
gsutil -m setmeta -h "Content-Type:image/png" "gs://${BUCKET}/*.png" 2>/dev/null || true
gsutil -m setmeta -h "Content-Type:image/png" "gs://${BUCKET}/favicon.png" 2>/dev/null || true
gsutil -m setmeta -h "Content-Type:image/png" "gs://${BUCKET}/logo.png" 2>/dev/null || true

# Invalidate CDN cache for index.html to ensure fresh content
log "Invalidating CDN cache for index.html..."
URL_MAP="intexuraos-web-${ENVIRONMENT}-url-map"
gcloud compute url-maps invalidate-cdn-cache "${URL_MAP}" \
  --path "/index.html" \
  --async \
  2>/dev/null || log "CDN cache invalidation skipped (no load balancer or permission issue)"

log "Deployment complete for ${SERVICE}"
