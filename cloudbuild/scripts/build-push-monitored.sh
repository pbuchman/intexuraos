#!/bin/bash
set -e

# Usage: ./build-push-monitored.sh <SERVICE_NAME> <DOCKERFILE_PATH>
SERVICE_NAME=$1
DOCKERFILE_PATH=$2

# Retry configuration
MAX_RETRIES=3
RETRY_DELAY=10

if [ -z "$SERVICE_NAME" ] || [ -z "$DOCKERFILE_PATH" ]; then
  echo "Usage: $0 <SERVICE_NAME> <DOCKERFILE_PATH>"
  exit 1
fi

echo "🚀 [START] Building $SERVICE_NAME using $DOCKERFILE_PATH"

push_with_retry() {
  local image=$1
  local attempt=1

  while [ $attempt -le $MAX_RETRIES ]; do
    echo "📤 [PUSH] Attempt $attempt/$MAX_RETRIES: $image"
    if docker push --max-concurrent-uploads=2 "$image"; then
      echo "✅ [PUSH] Success: $image"
      return 0
    fi
    echo "⚠️ [PUSH] Failed, waiting ${RETRY_DELAY}s before retry..."
    sleep $RETRY_DELAY
    attempt=$((attempt + 1))
  done

  echo "❌ [PUSH] Failed after $MAX_RETRIES attempts: $image"
  return 1
}

# Pull cache (allow failure - fresh build is fine)
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

# Push with retries
echo "📤 [PUSH] Pushing images with retry logic..."
push_with_retry "${ARTIFACT_REGISTRY_URL}/${SERVICE_NAME}:${COMMIT_SHA}"
push_with_retry "${ARTIFACT_REGISTRY_URL}/${SERVICE_NAME}:latest"

echo "✅ [SUCCESS] $SERVICE_NAME built and pushed."
