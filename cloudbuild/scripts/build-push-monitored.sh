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
    if docker push "$image"; then
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

# Multi-arch services need buildx to produce a manifest for both amd64 and arm64.
# claude-worker contains native binaries (Claude CLI, terraform, gdb) that crash
# under Rosetta emulation on Apple Silicon — it must run natively on both archs.
MULTI_ARCH_SERVICES="claude-worker"

if echo "$MULTI_ARCH_SERVICES" | grep -qw "$SERVICE_NAME"; then
  echo "🔨 [BUILD] Multi-arch build for $SERVICE_NAME (amd64 + arm64)..."

  # Ensure QEMU binfmt is registered for cross-platform builds.
  # This is idempotent and survives reboots/reinstalls by re-running each deploy.
  if ! cat /proc/sys/fs/binfmt_misc/qemu-aarch64 >/dev/null 2>&1; then
    echo "📦 [SETUP] Registering QEMU binfmt for cross-platform builds..."
    docker run --rm --privileged multiarch/qemu-user-static --reset -p yes >/dev/null 2>&1
  fi

  # Ensure buildx builder with multi-platform support exists
  docker buildx inspect multiarch >/dev/null 2>&1 || \
    docker buildx create --name multiarch --driver docker-container --use
  docker buildx use multiarch

  # buildx --push builds both platforms and pushes the manifest in one step
  docker buildx build \
    --platform linux/amd64,linux/arm64 \
    --build-arg BUILDKIT_INLINE_CACHE=1 \
    --build-arg CACHE_BUST="${COMMIT_SHA}" \
    --cache-from="${ARTIFACT_REGISTRY_URL}/${SERVICE_NAME}:latest" \
    -t "${ARTIFACT_REGISTRY_URL}/${SERVICE_NAME}:${COMMIT_SHA}" \
    -t "${ARTIFACT_REGISTRY_URL}/${SERVICE_NAME}:latest" \
    --push \
    -f "$DOCKERFILE_PATH" .

  echo "✅ [SUCCESS] $SERVICE_NAME multi-arch built and pushed."
else
  # Pull cache (allow failure - fresh build is fine)
  echo "📥 [PULL] Warming cache for $SERVICE_NAME..."
  docker pull "${ARTIFACT_REGISTRY_URL}/${SERVICE_NAME}:latest" || echo "⚠️ Cache pull failed, starting fresh."

  # Build (use COMMIT_SHA as cache buster to ensure source changes are picked up)
  echo "🔨 [BUILD] Building image..."
  docker build \
    --cache-from="${ARTIFACT_REGISTRY_URL}/${SERVICE_NAME}:latest" \
    --build-arg BUILDKIT_INLINE_CACHE=1 \
    --build-arg CACHE_BUST="${COMMIT_SHA}" \
    -t "${ARTIFACT_REGISTRY_URL}/${SERVICE_NAME}:${COMMIT_SHA}" \
    -t "${ARTIFACT_REGISTRY_URL}/${SERVICE_NAME}:latest" \
    -f "$DOCKERFILE_PATH" .

  # Push with retries
  echo "📤 [PUSH] Pushing images with retry logic..."
  push_with_retry "${ARTIFACT_REGISTRY_URL}/${SERVICE_NAME}:${COMMIT_SHA}"
  push_with_retry "${ARTIFACT_REGISTRY_URL}/${SERVICE_NAME}:latest"

  echo "✅ [SUCCESS] $SERVICE_NAME built and pushed."
fi
