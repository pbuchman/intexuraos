#!/bin/bash
set -euo pipefail

# ==============================================================================
# Build Code Worker Docker Image
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

PROJECT_ID="${PROJECT_ID:-intexuraos-dev-pbuchman}"
REGION="${REGION:-europe-central2}"
ENVIRONMENT="${ENVIRONMENT:-dev}"

# Use Artifact Registry URL (from env var or default)
ARTIFACT_REGISTRY_URL="${ARTIFACT_REGISTRY_URL:-${REGION}-docker.pkg.dev/${PROJECT_ID}/intexuraos-${ENVIRONMENT}}"
IMAGE_NAME="${ARTIFACT_REGISTRY_URL}/code-worker"
IMAGE_TAG="${1:-latest}"

echo "========================================"
echo "Building Code Worker image"
echo "========================================"
echo "Image: ${IMAGE_NAME}:${IMAGE_TAG}"
echo "Context: ${PROJECT_ROOT} (root)"
echo ""

# Change to project root for correct context
cd "$PROJECT_ROOT"

# Multi-arch build: produces amd64 + arm64 manifest so the image runs natively
# on both x86_64 (home-dev) and Apple Silicon (local Mac) without Rosetta.
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"

# Ensure buildx builder exists
docker buildx inspect multiarch >/dev/null 2>&1 || \
    docker buildx create --name multiarch --driver docker-container --use
docker buildx use multiarch

if [ "${PUSH:-false}" = "true" ]; then
    echo "Building + pushing multi-arch image (${PLATFORMS})..."
    docker buildx build \
        --platform "${PLATFORMS}" \
        -t "${IMAGE_NAME}:${IMAGE_TAG}" \
        --push \
        -f workers/code-worker/Dockerfile \
        .
    echo ""
    echo "Push complete: ${IMAGE_NAME}:${IMAGE_TAG}"
else
    echo "Building multi-arch image (${PLATFORMS}) — local load..."
    # --load only works with a single platform; build for host arch only
    docker buildx build \
        -t "${IMAGE_NAME}:${IMAGE_TAG}" \
        --load \
        -f workers/code-worker/Dockerfile \
        .
    echo ""
    echo "Build complete: ${IMAGE_NAME}:${IMAGE_TAG}"
    echo ""

    # Verify the image
    echo "Verifying image..."
    docker run --rm "${IMAGE_NAME}:${IMAGE_TAG}" --help 2>/dev/null || echo "(Worker help check - may fail without full setup)"

    # Show image size
    echo ""
    echo "Image size:"
    docker images "${IMAGE_NAME}:${IMAGE_TAG}" --format "{{.Size}}"
fi

echo ""
echo "Done: ${IMAGE_NAME}:${IMAGE_TAG}"
echo ""
echo "To build + push multi-arch: PUSH=true $0 ${IMAGE_TAG}"
