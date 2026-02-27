#!/usr/bin/env bash
# provision-cleanup-cron.sh — Install the container cleanup cron on a VM.
#
# Copies the cleanup script and installs systemd service + timer.
# Run once during VM provisioning or manually.
#
# Usage:
#   sudo ./provision-cleanup-cron.sh [script_source_dir]
#
# Arguments:
#   script_source_dir — Directory containing cleanup-containers.sh
#                       (default: same directory as this script)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="${1:-${SCRIPT_DIR}}"
INSTALL_DIR="/opt/intexuraos/workers/scripts"
LOG_DIR="/var/log/intexuraos"

echo "=== IntexuraOS Container Cleanup Provisioning ==="

# Must run as root
if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERROR: This script must be run as root (use sudo)"
  exit 1
fi

# Pre-flight: verify source files exist
for required_file in cleanup-containers.sh container-cleanup.service container-cleanup.timer; do
  if [[ ! -f "${SOURCE_DIR}/${required_file}" ]]; then
    echo "ERROR: Required file not found: ${SOURCE_DIR}/${required_file}"
    exit 1
  fi
done

# 1. Create directories
echo "[1/5] Creating directories..."
mkdir -p "${INSTALL_DIR}"
mkdir -p "${LOG_DIR}"

# 2. Copy cleanup script
echo "[2/5] Installing cleanup script..."
cp "${SOURCE_DIR}/cleanup-containers.sh" "${INSTALL_DIR}/cleanup-containers.sh"
chmod +x "${INSTALL_DIR}/cleanup-containers.sh"

# 3. Install systemd units
echo "[3/5] Installing systemd units..."
cp "${SOURCE_DIR}/container-cleanup.service" /etc/systemd/system/
cp "${SOURCE_DIR}/container-cleanup.timer"   /etc/systemd/system/

# 4. Configure log rotation
echo "[4/5] Configuring log rotation..."
cat > /etc/logrotate.d/intexuraos-container-cleanup <<'LOGROTATE'
/var/log/intexuraos/container-cleanup.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0644 root root
}
LOGROTATE

# 5. Enable and start timer
echo "[5/5] Enabling systemd timer..."
systemctl daemon-reload
systemctl enable container-cleanup.timer
systemctl start container-cleanup.timer

echo ""
echo "=== Provisioning complete ==="
echo "Timer status:"
systemctl list-timers container-cleanup.timer --no-pager
echo ""
echo "To run manually:  sudo systemctl start container-cleanup.service"
echo "To view logs:     cat ${LOG_DIR}/container-cleanup.log"
