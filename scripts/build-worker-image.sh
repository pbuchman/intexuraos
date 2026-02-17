#!/bin/bash
set -euo pipefail

# ==============================================================================
# Build Claude Worker Docker Image
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

PROJECT_ID="${PROJECT_ID:-intexuraos-dev-pbuchman}"
REGION="${REGION:-europe-central2}"
ENVIRONMENT="${ENVIRONMENT:-dev}"

# Use Artifact Registry URL (from env var or default)
ARTIFACT_REGISTRY_URL="${ARTIFACT_REGISTRY_URL:-${REGION}-docker.pkg.dev/${PROJECT_ID}/intexuraos-${ENVIRONMENT}}"
IMAGE_NAME="${ARTIFACT_REGISTRY_URL}/claude-worker"
IMAGE_TAG="${1:-latest}"

echo "========================================"
echo "Building Claude worker image"
echo "========================================"
echo "Image: ${IMAGE_NAME}:${IMAGE_TAG}"
echo "Context: ${PROJECT_ROOT} (root)"
echo ""

# Change to project root for correct context
cd "$PROJECT_ROOT"

# Build from root context (Dockerfile uses root-relative COPY paths)
docker build \
    -t "${IMAGE_NAME}:${IMAGE_TAG}" \
    -f workers/claude-worker/Dockerfile \
    .

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
    echo "Pushing to Artifact Registry..."
    docker push "${IMAGE_NAME}:${IMAGE_TAG}"
    echo "Push complete."
fi

echo ""
echo "Done: ${IMAGE_NAME}:${IMAGE_TAG}"
echo ""
echo "To push: PUSH=true $0 ${IMAGE_TAG}"
