#!/usr/bin/env bash
# push-missing-images.sh - Build and push missing Docker images to Artifact Registry
#
# This script:
# 1. Detects which services have Dockerfiles in apps/
# 2. Checks which images already exist in Artifact Registry
# 3. Prompts for confirmation to build missing images
# 4. Builds and pushes each missing image
#
# Usage:
#   ./scripts/push-missing-images.sh
#
# Prerequisites:
#   - PROJECT_ID environment variable set
#   - Docker installed and running
#   - Authenticated to GCP: gcloud auth configure-docker europe-central2-docker.pkg.dev

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Configuration
REGION="europe-central2"
REPO_NAME="intexuraos-dev"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}ℹ${NC} $1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
log_error() { echo -e "${RED}✗${NC} $1"; }

# Validate Dockerfile references only existing packages
validate_dockerfile() {
    local service="$1"
    local dockerfile="${REPO_ROOT}/apps/${service}/Dockerfile"
    local errors=()

    if [[ ! -f "$dockerfile" ]]; then
        log_error "Dockerfile not found: $dockerfile"
        return 1
    fi

    # Extract COPY commands for packages and check they exist
    while IFS= read -r line; do
        # Skip glob patterns (packages/* or packages/) - these copy all packages
        if [[ "$line" =~ COPY[[:space:]]+packages/\*/ ]] || [[ "$line" =~ COPY[[:space:]]+packages/[[:space:]] ]]; then
            continue
        fi
        # Match COPY commands like: COPY packages/xxx/package*.json
        if [[ "$line" =~ COPY[[:space:]]+packages/([^/\*]+)/ ]]; then
            local pkg="${BASH_REMATCH[1]}"
            local pkg_dir="${REPO_ROOT}/packages/${pkg}"
            if [[ ! -d "$pkg_dir" ]]; then
                errors+=("Package directory not found: packages/${pkg}")
            elif [[ ! -f "${pkg_dir}/package.json" ]]; then
                errors+=("Missing package.json in: packages/${pkg}")
            fi
        fi
        # Match workspace references like: -w @intexuraos/xxx or --workspace=@intexuraos/xxx
        if [[ "$line" =~ @intexuraos/([a-z0-9-]+) ]]; then
            local ws_name="${BASH_REMATCH[1]}"
            # Check if it's an app or package
            if [[ -d "${REPO_ROOT}/apps/${ws_name}" ]]; then
                continue
            elif [[ -d "${REPO_ROOT}/packages/${ws_name}" ]]; then
                if [[ ! -f "${REPO_ROOT}/packages/${ws_name}/package.json" ]]; then
                    errors+=("Missing package.json for workspace: @intexuraos/${ws_name}")
                fi
            else
                errors+=("Unknown workspace reference: @intexuraos/${ws_name}")
            fi
        fi
    done < "$dockerfile"

    if [[ ${#errors[@]} -gt 0 ]]; then
        log_error "Dockerfile validation failed for ${service}:"
        for err in "${errors[@]}"; do
            echo -e "    ${RED}•${NC} $err"
        done
        return 1
    fi

    return 0
}

# Verify we're in the correct directory
verify_directory() {
    if [[ ! -d "${REPO_ROOT}/apps" ]]; then
        log_error "Directory 'apps/' not found. Run this script from the repository root or scripts/ directory."
        exit 1
    fi
    log_success "Found apps/ directory"
}

# Get project ID from environment
get_project_id() {
    local project_id="${PROJECT_ID:-}"

    if [[ -z "$project_id" ]]; then
        log_error "PROJECT_ID environment variable not set."
        log_error "Run: export PROJECT_ID=intexuraos-dev-yourname"
        exit 1
    fi

    echo "$project_id"
}

# Get list of services with Dockerfiles
get_local_services() {
    local services=()
    for dockerfile in "${REPO_ROOT}"/apps/*/Dockerfile; do
        if [[ -f "$dockerfile" ]]; then
            local service_dir
            service_dir=$(dirname "$dockerfile")
            services+=("$(basename "$service_dir")")
        fi
    done
    echo "${services[@]}"
}

# Check if image exists in Artifact Registry
image_exists() {
    local registry="$1"
    local service="$2"

    # Try to get image manifest - returns 0 if exists, non-zero if not
    if gcloud artifacts docker images describe "${registry}/${service}:latest" &>/dev/null; then
        return 0
    else
        return 1
    fi
}

# Build and push a single service
build_and_push() {
    local registry="$1"
    local service="$2"
    local dockerfile="${REPO_ROOT}/apps/${service}/Dockerfile"
    local image_tag="${registry}/${service}:latest"

    # Validate Dockerfile before building
    if ! validate_dockerfile "$service"; then
        log_error "Skipping ${service} due to Dockerfile validation errors"
        return 1
    fi

    log_info "Building ${service}..."

    if ! docker build \
        --platform linux/amd64 \
        -f "$dockerfile" \
        -t "$image_tag" \
        "${REPO_ROOT}"; then
        log_error "Failed to build ${service}"
        return 1
    fi

    log_info "Pushing ${service}..."

    if ! docker push "$image_tag"; then
        log_error "Failed to push ${service}"
        return 1
    fi

    log_success "Successfully pushed ${service}"
    return 0
}

main() {
    echo ""
    echo "=========================================="
    echo "  Push Missing Images to Artifact Registry"
    echo "=========================================="
    echo ""

    # Verify directory
    verify_directory

    # Get project ID
    local project_id
    project_id=$(get_project_id)
    log_success "Project ID: ${project_id}"

    # Build registry URL
    local registry="${REGION}-docker.pkg.dev/${project_id}/${REPO_NAME}"
    log_info "Registry: ${registry}"
    echo ""

    # Get all local services
    local all_services
    read -ra all_services <<< "$(get_local_services)"
    log_info "Found ${#all_services[@]} services with Dockerfiles: ${all_services[*]}"
    echo ""

    # Check which images are missing
    local missing_services=()
    local existing_services=()

    log_info "Checking existing images in Artifact Registry..."
    for service in "${all_services[@]}"; do
        if image_exists "$registry" "$service"; then
            existing_services+=("$service")
            log_success "  ${service}: exists"
        else
            missing_services+=("$service")
            log_warning "  ${service}: MISSING"
        fi
    done
    echo ""

    # Summary
    if [[ ${#existing_services[@]} -gt 0 ]]; then
        log_info "Existing images (${#existing_services[@]}): ${existing_services[*]}"
    fi

    if [[ ${#missing_services[@]} -eq 0 ]]; then
        log_success "All images already exist in Artifact Registry!"
        exit 0
    fi

    echo ""
    log_warning "Missing images (${#missing_services[@]}): ${missing_services[*]}"
    echo ""

    # Confirm before building
    echo -e "${YELLOW}The following services will be built and pushed:${NC}"
    for service in "${missing_services[@]}"; do
        echo "  - ${service}"
    done
    echo ""

    read -rp "Proceed with building and pushing? [y/N] " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
        log_info "Aborted by user"
        exit 0
    fi
    echo ""

    # Build and push each missing service
    local failed_services=()
    local success_count=0

    for service in "${missing_services[@]}"; do
        echo ""
        echo "----------------------------------------"
        echo "  Building: ${service}"
        echo "----------------------------------------"

        if build_and_push "$registry" "$service"; then
            ((success_count++))
        else
            failed_services+=("$service")
        fi
    done

    # Final summary
    echo ""
    echo "=========================================="
    echo "  Summary"
    echo "=========================================="
    log_success "Successfully pushed: ${success_count}/${#missing_services[@]}"

    if [[ ${#failed_services[@]} -gt 0 ]]; then
        log_error "Failed services: ${failed_services[*]}"
        exit 1
    fi

    echo ""
    log_success "All missing images have been pushed!"
    log_info "You can now re-run: terraform apply"
}

main "$@"

