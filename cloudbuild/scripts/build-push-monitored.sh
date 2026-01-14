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

# --- BUILD LOGIC ---

# Pull Cache (Allow failure)
echo "📥 [PULL] Warming cache for $SERVICE_NAME..."
docker pull "${ARTIFACT_REGISTRY_URL}/${SERVICE_NAME}:latest" || echo "⚠️ Cache pull failed, starting fresh."

# Build
echo "🔨 [BUILD] Building image..."
docker build \
  --cache-from="${ARTIFACT_REGISTRY_URL}/${SERVICE_NAME}:latest" \
  --build-arg BUILDKIT_INLINE_CACHE=1 \
  -t "${ARTIFACT_REGISTRY_URL}/${SERVICE_NAME}:${COMMIT_SHA}" \
  -t "${ARTIFACT_REGISTRY_URL}/${SERVICE_NAME}:latest" \
  -f "$DOCKERFILE_PATH" .

# Push
echo "📤 [PUSH] Pushing images..."
docker push "${ARTIFACT_REGISTRY_URL}/${SERVICE_NAME}:${COMMIT_SHA}"
docker push "${ARTIFACT_REGISTRY_URL}/${SERVICE_NAME}:latest"

# Capture exit code
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  echo "✅ [SUCCESS] $SERVICE_NAME built and pushed."
else
  echo "❌ [FAILURE] Build failed for $SERVICE_NAME."
fi

exit $EXIT_CODE
