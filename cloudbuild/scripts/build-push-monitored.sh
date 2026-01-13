#!/bin/bash
set -e

# Usage: ./build-push-monitored.sh <SERVICE_NAME> <DOCKERFILE_PATH>
SERVICE_NAME=$1
DOCKERFILE_PATH=$2

# Check inputs
if [ -z "$SERVICE_NAME" ] || [ -z "$DOCKERFILE_PATH" ]; then
  echo "Usage: $0 <SERVICE_NAME> <DOCKERFILE_PATH>"
  exit 1
fi

echo "🚀 [START] Building $SERVICE_NAME using $DOCKERFILE_PATH"

# --- 1. START METRICS SIDECAR (Background Process) ---
(
  # Define interface (eth0 is standard in Cloud Build)
  IFACE="eth0"

  # Initial reads
  if [ -f "/sys/class/net/$IFACE/statistics/rx_bytes" ]; then
      R1=$(cat /sys/class/net/$IFACE/statistics/rx_bytes)
      T1=$(cat /sys/class/net/$IFACE/statistics/tx_bytes)
  else
      # Fallback if interface differs
      echo "Interface $IFACE not found, skipping metrics."
      exit 0
  fi

  while true; do
    sleep 5 # Sample every 5 seconds

    R2=$(cat /sys/class/net/$IFACE/statistics/rx_bytes)
    T2=$(cat /sys/class/net/$IFACE/statistics/tx_bytes)

    # Calculate Delta (Bytes)
    RB=$(( R2 - R1 ))
    TB=$(( T2 - T1 ))

    # Convert to Mbps (approx: Bytes * 8 / 5s / 1024 / 1024)
    # Using integer math
    RX_MBPS=$(( (RB * 8) / 5 / 1048576 ))
    TX_MBPS=$(( (TB * 8) / 5 / 1048576 ))

    # Structured log to stdout (for build log visibility)
    # Format: NT service <name> rx <value> tx <value>
    # Parseable by Google Logging metrics (NT = Network Telemetry)
    echo "NT service $SERVICE_NAME rx $RX_MBPS tx $TX_MBPS"

    # Reset counters
    R1=$R2
    T1=$T2
  done
) &
METRICS_PID=$!

# --- 2. EXECUTE BUILD LOGIC ---

# 2a. Pull Cache (Allow failure)
echo "📥 [PULL] Warming cache for $SERVICE_NAME..."
docker pull "${ARTIFACT_REGISTRY_URL}/${SERVICE_NAME}:latest" || echo "⚠️ Cache pull failed, starting fresh."

# 2b. Build
echo "🔨 [BUILD] Building image..."
docker build \
  --cache-from="${ARTIFACT_REGISTRY_URL}/${SERVICE_NAME}:latest" \
  --build-arg BUILDKIT_INLINE_CACHE=1 \
  -t "${ARTIFACT_REGISTRY_URL}/${SERVICE_NAME}:${COMMIT_SHA}" \
  -t "${ARTIFACT_REGISTRY_URL}/${SERVICE_NAME}:latest" \
  -f "$DOCKERFILE_PATH" .

# 2c. Push
echo "📤 [PUSH] Pushing images..."
docker push "${ARTIFACT_REGISTRY_URL}/${SERVICE_NAME}:${COMMIT_SHA}"
docker push "${ARTIFACT_REGISTRY_URL}/${SERVICE_NAME}:latest"

# Capture exit code
EXIT_CODE=$?

# --- 3. CLEANUP ---
kill $METRICS_PID 2>/dev/null || true

if [ $EXIT_CODE -eq 0 ]; then
  echo "✅ [SUCCESS] $SERVICE_NAME built and pushed."
else
  echo "❌ [FAILURE] Build failed for $SERVICE_NAME."
fi

exit $EXIT_CODE
