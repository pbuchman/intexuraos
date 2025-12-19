#!/usr/bin/env bash
#
# Deploy affected services to Cloud Run.
#
# This script is executed by Cloud Build after images are built and pushed.
# It reads /workspace/affected.json to determine which services to deploy.
#
# Required environment variables:
#   REGION                - GCP region (from Terraform trigger)
#   ARTIFACT_REGISTRY_URL - Full Artifact Registry URL (from Terraform trigger)
#   COMMIT_SHA            - Git commit SHA (from Cloud Build)
#
# Optional:
#   ENVIRONMENT           - Environment name (dev, staging, prod)
#

set -euo pipefail

WORKSPACE="${WORKSPACE:-/workspace}"
AFFECTED_FILE="${WORKSPACE}/affected.json"

echo "=== Deploy Affected Services ==="
echo "REGION: ${REGION:-not set}"
echo "ARTIFACT_REGISTRY_URL: ${ARTIFACT_REGISTRY_URL:-not set}"
echo "COMMIT_SHA: ${COMMIT_SHA:-not set}"
echo "ENVIRONMENT: ${ENVIRONMENT:-not set}"

# Validate required environment variables
validate_env() {
  local missing=()

  [[ -z "${REGION:-}" ]] && missing+=("REGION")
  [[ -z "${ARTIFACT_REGISTRY_URL:-}" ]] && missing+=("ARTIFACT_REGISTRY_URL")
  [[ -z "${COMMIT_SHA:-}" ]] && missing+=("COMMIT_SHA")

  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "ERROR: Missing required environment variables:"
    for var in "${missing[@]}"; do
      echo "  - $var"
    done
    echo ""
    echo "These should be provided by the Cloud Build trigger (Terraform)."
    exit 1
  fi
}

# Read affected services from JSON file
read_affected() {
  if [[ ! -f "$AFFECTED_FILE" ]]; then
    echo "ERROR: Affected file not found at $AFFECTED_FILE"
    echo "This file should be created by detect-affected.mjs"
    exit 1
  fi

  echo "Contents of $AFFECTED_FILE:"
  cat "$AFFECTED_FILE"
  echo ""

  # Extract service names from JSON (handles both single-line and multi-line JSON)
  # First, remove newlines to get single-line JSON
  local json_oneline
  json_oneline=$(tr -d '\n' < "$AFFECTED_FILE")

  # Extract everything between "services": [ and ]
  local services_array
  services_array=$(echo "$json_oneline" | sed -n 's/.*"services"[[:space:]]*:[[:space:]]*\[\([^]]*\)\].*/\1/p')

  if [[ -z "$services_array" ]]; then
    echo "ERROR: Could not parse 'services' array from $AFFECTED_FILE"
    exit 1
  fi

  # Extract individual service names (words with hyphens)
  echo "$services_array" | grep -oE '"[a-z][-a-z]*"' | tr -d '"'
}

# Map service name to Cloud Run service name
get_cloud_run_name() {
  local service="$1"
  case "$service" in
    auth-service)
      echo "praxos-auth-service"
      ;;
    notion-gpt-service)
      echo "praxos-notion-gpt-service"
      ;;
    whatsapp-service)
      echo "praxos-whatsapp-service"
      ;;
    api-docs-hub)
      echo "praxos-api-docs-hub"
      ;;
    *)
      echo ""
      ;;
  esac
}

# Deploy a single service to Cloud Run
deploy_service() {
  local service="$1"
  local cloud_run_name
  cloud_run_name=$(get_cloud_run_name "$service")

  if [[ -z "$cloud_run_name" ]]; then
    echo "ERROR: Unknown service: $service"
    return 1
  fi

  local image="${ARTIFACT_REGISTRY_URL}/${service}:${COMMIT_SHA}"

  echo ""
  echo "=== Deploying $service ==="
  echo "  Cloud Run service: $cloud_run_name"
  echo "  Image: $image"
  echo "  Region: $REGION"

  if gcloud run deploy "$cloud_run_name" \
    --image="$image" \
    --region="$REGION" \
    --platform=managed \
    --allow-unauthenticated \
    --quiet; then
    echo "  ✓ $service deployed successfully"
    return 0
  else
    echo "  ✗ Failed to deploy $service"
    return 1
  fi
}

# Main
main() {
  validate_env

  echo ""
  echo "Reading affected services from: $AFFECTED_FILE"

  local services
  services=$(read_affected)

  if [[ -z "$services" ]]; then
    echo ""
    echo "No services to deploy. Exiting successfully."
    exit 0
  fi

  echo "Affected services:"
  for svc in $services; do
    echo "  - $svc"
  done

  local failed=0
  for service in $services; do
    if ! deploy_service "$service"; then
      failed=1
    fi
  done

  echo ""
  echo "=== Deployment Summary ==="
  if [[ $failed -eq 0 ]]; then
    echo "All affected services deployed successfully."
    exit 0
  else
    echo "Some services failed to deploy."
    exit 1
  fi
}

main "$@"

