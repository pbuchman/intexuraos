#!/bin/bash
set -euo pipefail

# Set HOME for root (required by npm/pnpm)
export HOME=/root

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

# Get target branch from Firestore (set by webhook when VM was started)
# Falls back to instance metadata, then defaults to 'development'
TARGET_BRANCH=$(gcloud firestore documents predev-state/current \
  --format="value(fields.branch.stringValue)" 2>/dev/null || \
  curl -s -f -H "Metadata-Flavor: Google" \
  "http://metadata.google.internal/computeMetadata/v1/instance/attributes/target-branch" 2>/dev/null || \
  echo "development")

log "Checking out branch: $TARGET_BRANCH"
git checkout "$TARGET_BRANCH"
git pull origin "$TARGET_BRANCH"

# Get predev env vars from Secret Manager
log "Fetching predev environment variables from Secret Manager..."
gcloud secrets versions access latest --secret="INTEXURAOS_PREDEV_ENV_VARS" --quiet > "$REPO_DIR/.envrc.local"

# Copy to .env for Vite (Vite reads .env files automatically)
log "Copying env vars to .env for Vite build..."
cp "$REPO_DIR/.envrc.local" "$REPO_DIR/.env"

# Source env vars for build (Vite needs them at build time for client bundle)
log "Loading environment variables for build..."
cd "$REPO_DIR"
# shellcheck source=/dev/null disable=SC1091
set -a && . .envrc.local && set +a

# Install dependencies
log "Installing dependencies..."
pnpm install --frozen-lockfile

# Build packages (env vars now loaded for client bundle)
log "Building packages..."
pnpm build

# Fix ownership - build runs as root but PM2 runs services as p.buchman
# Ensure p.buchman user exists and owns the repo directory
if ! id -u p.buchman > /dev/null 2>&1; then
  useradd -m -s /bin/bash p.buchman
fi

# Fix git ownership issue - add repo to git safe.directory
git config --global --add safe.directory "$REPO_DIR"
chown -R p.buchman:p.buchman "$REPO_DIR"
log "Fixed ownership for p.buchman user"

# Start services with PM2
log "Starting services with PM2..."
# Set PREDEV_ENVIRONMENT to use preview mode (no HMR, works through proxy)
export PREDEV_ENVIRONMENT=true
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

  # Get identity token for authentication
  ID_TOKEN=$(curl -s -H "Metadata-Flavor: Google" \
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=$REPORT_READY_URL")

  if [ -n "$ID_TOKEN" ]; then
    curl -s -X POST "$REPORT_READY_URL" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $ID_TOKEN" \
      -d "{\"ip\": \"$EXTERNAL_IP\", \"branch\": \"$TARGET_BRANCH\"}" && log "Reported ready successfully" || log "Failed to report ready"
  else
    log "Failed to get identity token"
  fi
else
  log "No REPORT_READY_URL set, skipping ready callback"
fi

log "Pre-dev VM ready! IP: $EXTERNAL_IP, Branch: $TARGET_BRANCH"
