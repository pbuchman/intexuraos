#!/bin/bash
set -euo pipefail

REPO_DIR="/opt/intexuraos"
LOG_FILE="/var/log/predev-startup.log"

log() {
  echo "[$(date -Iseconds)] $*" | tee -a "$LOG_FILE"
}

log "Starting pre-dev VM setup..."

# Install dependencies
log "Installing system dependencies..."
apt-get update -qq
apt-get install -y -qq git curl build-essential

# Install Node.js 22
log "Installing Node.js 22..."
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y -qq nodejs

# Install pnpm
log "Installing pnpm..."
corepack enable
corepack prepare pnpm@latest --activate

# Install PM2
log "Installing PM2..."
npm install -g pm2

# Clone repository
log "Cloning repository..."
if [ -d "$REPO_DIR" ]; then
  cd "$REPO_DIR"
  git fetch --all
else
  git clone https://github.com/pbuchman/intexuraos.git "$REPO_DIR"
  cd "$REPO_DIR"
fi

# Get target branch from instance metadata (default to development)
TARGET_BRANCH=$(curl -s -H "Metadata-Flavor: Google" \
  "http://metadata.google.internal/computeMetadata/v1/instance/attributes/target-branch" 2>/dev/null || echo "development")

log "Checking out branch: $TARGET_BRANCH"
git checkout "$TARGET_BRANCH"
git pull origin "$TARGET_BRANCH"

# Get predev env vars from Secret Manager
log "Fetching predev environment variables from Secret Manager..."
gcloud secrets versions access latest --secret="INTEXURAOS_PREDEV_ENV_VARS" --quiet > "$REPO_DIR/.envrc.local"

# Install dependencies
log "Installing dependencies..."
cd "$REPO_DIR"
pnpm install --frozen-lockfile

# Build packages
log "Building packages..."
pnpm build

# Start services with PM2
log "Starting services with PM2..."
pm2 start ecosystem.config.cjs
pm2 save

# Get VM's external IP
EXTERNAL_IP=$(curl -s -H "Metadata-Flavor: Google" \
  "http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip")

# Get report-ready URL from instance metadata
REPORT_READY_URL=$(curl -s -H "Metadata-Flavor: Google" \
  "http://metadata.google.internal/computeMetadata/v1/instance/attributes/report-ready-url" 2>/dev/null || echo "")

if [ -n "$REPORT_READY_URL" ]; then
  log "Reporting ready to: $REPORT_READY_URL"
  curl -X POST "$REPORT_READY_URL" \
    -H "Content-Type: application/json" \
    -d "{\"ip\": \"$EXTERNAL_IP\", \"branch\": \"$TARGET_BRANCH\"}" || log "Failed to report ready"
else
  log "No REPORT_READY_URL set, skipping ready callback"
fi

log "Pre-dev VM ready! IP: $EXTERNAL_IP, Branch: $TARGET_BRANCH"
