#!/usr/bin/env bash
# deploy-workers.sh - Deploy Cloud Function workers to GCS for local development
#
# This script:
# 1. Builds the specified worker(s)
# 2. Generates production package.json
# 3. Creates function.zip
# 4. Uploads to GCS functions source bucket
#
# Usage:
#   ./scripts/deploy-workers.sh                  # Interactive: choose workers to deploy
#   ./scripts/deploy-workers.sh vm-lifecycle     # Deploy specific worker
#   ./scripts/deploy-workers.sh --all            # Deploy all workers
#
# Prerequisites:
#   - PROJECT_ID environment variable set
#   - gcloud auth configure-docker (optional, not needed for GCS)
#   - Authenticated to GCP: gcloud auth login or service account

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Configuration
REGION="europe-central2"
ENVIRONMENT="dev"

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

# Get list of available workers
get_available_workers() {
    local workers=()
    for pkg_json in "${REPO_ROOT}"/workers/*/package.json; do
        if [[ -f "$pkg_json" ]]; then
            local worker_dir
            worker_dir=$(dirname "$pkg_json")
            local worker_name
            worker_name=$(basename "$worker_dir")
            # Skip orchestrator (it's not a Cloud Function)
            if [[ "$worker_name" != "orchestrator" ]]; then
                workers+=("$worker_name")
            fi
        fi
    done
    echo "${workers[@]}"
}

# Verify gcloud authentication
verify_gcloud_auth() {
    log_info "Checking gcloud authentication..."

    if ! command -v gcloud &>/dev/null; then
        log_error "gcloud CLI is not installed. Install it from: https://cloud.google.com/sdk/docs/install"
        exit 1
    fi

    local account
    account=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null || true)

    if [[ -z "$account" ]]; then
        log_error "Not authenticated with gcloud."
        log_error "Run: gcloud auth login"
        exit 1
    fi

    log_success "Authenticated as: ${account}"
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

# Build and deploy a single worker
deploy_worker() {
    local worker="$1"
    local bucket="$2"
    local worker_dir="${REPO_ROOT}/workers/${worker}"

    if [[ ! -d "$worker_dir" ]]; then
        log_error "Worker directory not found: ${worker_dir}"
        return 1
    fi

    log_info "Building ${worker}..."
    if ! pnpm --filter "@intexuraos/${worker}" build; then
        log_error "Failed to build ${worker}"
        return 1
    fi

    if [[ ! -d "${worker_dir}/dist" ]]; then
        log_error "Build output not found: ${worker_dir}/dist"
        return 1
    fi

    log_info "Generating production package.json..."
    node -e "
      const fs = require('fs');
      const pkg = JSON.parse(fs.readFileSync('${worker_dir}/package.json', 'utf-8'));
      const prod = {
        name: pkg.name.replace('@intexuraos/', '') + '-prod',
        version: '1.0.0',
        type: 'module',
        main: 'index.js',
        dependencies: pkg.dependencies || {}
      };
      fs.writeFileSync('${worker_dir}/dist/package.json', JSON.stringify(prod, null, 2));
    "

    log_info "Creating function.zip..."
    cd "${worker_dir}/dist"
    rm -f function.zip
    zip -r function.zip .

    local dest_path="gs://${bucket}/${worker}/function.zip"
    log_info "Uploading to ${dest_path}..."

    local max_retries=3
    local retry_count=0
    while [[ $retry_count -lt $max_retries ]]; do
        if gsutil cp function.zip "${dest_path}"; then
            log_success "Successfully deployed ${worker}"
            cd "${REPO_ROOT}"
            return 0
        fi
        ((retry_count++))
        if [[ $retry_count -lt $max_retries ]]; then
            log_warning "Upload failed, retrying (${retry_count}/${max_retries})..."
            sleep 2
        fi
    done

    log_error "Failed to upload ${worker} after ${max_retries} attempts"
    cd "${REPO_ROOT}"
    return 1
}

main() {
    echo ""
    echo "=========================================="
    echo "  Deploy Cloud Function Workers"
    echo "=========================================="
    echo ""

    # Verify gcloud authentication
    verify_gcloud_auth

    # Get project ID
    local project_id
    project_id=$(get_project_id)
    log_success "Project ID: ${project_id}"

    # Determine bucket name
    local bucket="intexuraos-functions-source-${ENVIRONMENT}"
    log_info "Functions source bucket: ${bucket}"
    echo ""

    # Get available workers
    local available_workers
    read -ra available_workers <<< "$(get_available_workers)"
    log_info "Available workers: ${available_workers[*]}"
    echo ""

    # Determine which workers to deploy
    local workers_to_deploy=()

    if [[ $# -eq 0 ]]; then
        # Interactive mode
        echo -e "${YELLOW}Select workers to deploy:${NC}"
        for i in "${!available_workers[@]}"; do
            echo "  $((i+1)). ${available_workers[$i]}"
        done
        echo "  a. All workers"
        echo "  q. Quit"
        echo ""

        read -rp "Enter choice (e.g., 1, 2, a): " choice

        case "$choice" in
            [qQ])
                log_info "Aborted by user"
                exit 0
                ;;
            [aA])
                workers_to_deploy=("${available_workers[@]}")
                ;;
            *)
                # Parse numeric choice
                if [[ "$choice" =~ ^[0-9]+$ ]]; then
                    local idx=$((choice - 1))
                    if [[ $idx -ge 0 && $idx -lt ${#available_workers[@]} ]]; then
                        workers_to_deploy+=("${available_workers[$idx]}")
                    else
                        log_error "Invalid choice: ${choice}"
                        exit 1
                    fi
                else
                    log_error "Invalid choice: ${choice}"
                    exit 1
                fi
                ;;
        esac
    elif [[ "$1" == "--all" ]]; then
        workers_to_deploy=("${available_workers[@]}")
    else
        # Deploy specific worker
        local found=false
        for w in "${available_workers[@]}"; do
            if [[ "$w" == "$1" ]]; then
                workers_to_deploy+=("$1")
                found=true
                break
            fi
        done
        if [[ "$found" == "false" ]]; then
            log_error "Unknown worker: $1"
            log_info "Available workers: ${available_workers[*]}"
            exit 1
        fi
    fi

    if [[ ${#workers_to_deploy[@]} -eq 0 ]]; then
        log_error "No workers selected"
        exit 1
    fi

    echo ""
    echo -e "${YELLOW}Workers to deploy:${NC}"
    for w in "${workers_to_deploy[@]}"; do
        echo "  - ${w}"
    done
    echo ""

    read -rp "Proceed with deployment? [y/N] " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
        log_info "Aborted by user"
        exit 0
    fi
    echo ""

    # Deploy each worker
    local failed_workers=()
    local success_count=0

    for worker in "${workers_to_deploy[@]}"; do
        echo ""
        echo "----------------------------------------"
        echo "  Deploying: ${worker}"
        echo "----------------------------------------"

        if deploy_worker "$worker" "$bucket"; then
            success_count=$((success_count + 1))
        else
            failed_workers+=("$worker")
        fi
    done

    # Final summary
    echo ""
    echo "=========================================="
    echo "  Summary"
    echo "=========================================="
    log_success "Successfully deployed: ${success_count}/${#workers_to_deploy[@]}"

    if [[ ${#failed_workers[@]} -gt 0 ]]; then
        log_error "Failed workers: ${failed_workers[*]}"
        exit 1
    fi

    echo ""
    log_success "All workers deployed!"
    log_info "To update Cloud Functions, run: terraform apply"
}

main "$@"
