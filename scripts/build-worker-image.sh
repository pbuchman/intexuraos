#!/bin/bash
set -euo pipefail

# ==============================================================================
# Build Claude Worker Docker Image
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

PROJECT_ID="${PROJECT_ID:-intexuraos-dev-pbuchman}"
IMAGE_NAME="gcr.io/${PROJECT_ID}/claude-worker"
IMAGE_TAG="${1:-latest}"

echo "========================================"
echo "Building Claude worker image"
echo "========================================"
echo "Image: ${IMAGE_NAME}:${IMAGE_TAG}"
echo "Context: ${PROJECT_ROOT}/workers/claude-worker/"
echo ""

# Change to project root for correct context
cd "$PROJECT_ROOT"

# Build
docker build \
    -t "${IMAGE_NAME}:${IMAGE_TAG}" \
    -f workers/claude-worker/Dockerfile \
    workers/claude-worker/

echo ""
echo "Build complete: ${IMAGE_NAME}:${IMAGE_TAG}"
echo ""

# Verify the image
echo "Verifying image..."
docker run --rm "${IMAGE_NAME}:${IMAGE_TAG}" --help 2>/dev/null || echo "(Claude help check - may fail without full setup)"

# Show image size
echo ""
echo "Image size:"
docker images "${IMAGE_NAME}:${IMAGE_TAG}" --format "{{.Size}}"

# Push if requested
if [ "${PUSH:-false}" = "true" ]; then
    echo ""
    echo "Pushing to GCR..."
    docker push "${IMAGE_NAME}:${IMAGE_TAG}"
    echo "Push complete."
fi

echo ""
echo "Done: ${IMAGE_NAME}:${IMAGE_TAG}"
echo ""
echo "To push: PUSH=true $0 ${IMAGE_TAG}"
