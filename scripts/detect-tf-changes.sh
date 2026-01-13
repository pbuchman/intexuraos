#!/usr/bin/env bash
# Detects which apps/services are affected by Terraform changes.
# Prints affected service names, one per line.
#
# Usage: ./scripts/detect-tf-changes.sh [BASE_SHA] [HEAD_SHA]
# Defaults to comparing HEAD~1..HEAD

set -euo pipefail

BASE_SHA="${1:-HEAD~1}"
HEAD_SHA="${2:-HEAD}"

# All services in the monorepo
ALL_SERVICES=(
  "user-service"
  "promptvault-service"
  "notion-service"
  "whatsapp-service"
  "mobile-notifications-service"
  "api-docs-hub"
  "research-agent"
  "commands-agent"
  "actions-agent"
  "data-insights-agent"
  "image-service"
  "notes-agent"
  "todos-agent"
  "bookmarks-agent"
  "app-settings-service"
  "calendar-agent"
  "web-agent"
  "web"
)

# Terraform modules that affect ALL services
GLOBAL_MODULES=(
  "artifact-registry"     # All services use container registry
  "cloud-run-service"     # All services are Cloud Run services
  "iam"                   # All services use service accounts
  "secret-manager"        # All services use secrets
  "providers"             # terraform/providers.tf
  "variables"             # terraform/variables.tf
  "versions"              # terraform/versions.tf
)

# Mapping: terraform module directory -> services that use it
# Derived from terraform/environments/dev/main.tf module instances
declare -A MODULE_TO_SERVICES

# pubsub-push is used by many services (all topic instances)
MODULE_TO_SERVICES[pubsub-push]="whatsapp-service commands-agent actions-agent research-agent bookmarks-agent todos-agent data-insights-agent"

# Bucket modules
MODULE_TO_SERVICES[whatsapp-media-bucket]="whatsapp-service"
MODULE_TO_SERVICES[generated-images-bucket]="image-service"
MODULE_TO_SERVICES[shared-content]="research-agent"
MODULE_TO_SERVICES[static-assets]="web"
MODULE_TO_SERVICES[web-app]="web"

# Other modules
MODULE_TO_SERVICES[firestore]="all-services"  # Most services use Firestore
MODULE_TO_SERVICES[cloud-build]="ci-only"      # Affects deployment, not runtime
MODULE_TO_SERVICES[github-wif]="ci-only"
MODULE_TO_SERVICES[monitoring]="none"

# Track affected services
declare -A affected_services

# Get changed files in terraform directory
changed_files=$(git diff --name-only "${BASE_SHA}...${HEAD_SHA}" 2>/dev/null || git diff --name-only HEAD~1)

# Filter to only terraform files
tf_changed_files=$(echo "$changed_files" | grep -E "^terraform/" || true)

if [[ -z "$tf_changed_files" ]]; then
  # No terraform changes
  exit 0
fi

# Function to add service to affected list
add_affected_service() {
  _afs_service=$1
  _afs_reason=$2
  if [[ -z "${affected_services[$_afs_service]+x}" ]]; then
    affected_services["$_afs_service"]="$_afs_reason"
  fi
}

# Analyze each changed file
while IFS= read -r file; do
  # Skip lock files and backend
  case "$file" in
    *.lock.hcl|backend.tf|terraform.tfvars) continue ;;
  esac

  # Check if it's a module change
  if [[ "$file" =~ terraform/modules/([^/]+)/ ]]; then
    module="${BASH_REMATCH[1]}"

    # Check if it's a global module
    for global_mod in "${GLOBAL_MODULES[@]}"; do
      if [[ "$module" == "$global_mod" ]]; then
        # Affects all services
        for svc in "${ALL_SERVICES[@]}"; do
          add_affected_service "$svc" "global:$module"
        done
        continue 2
      fi
    done

    # Check module-to-services mapping
    if [[ -n "${MODULE_TO_SERVICES[$module]+x}" ]]; then
      services="${MODULE_TO_SERVICES[$module]}"
      if [[ "$services" == "all-services" ]]; then
        for svc in "${ALL_SERVICES[@]}"; do
          add_affected_service "$svc" "module:$module"
        done
      elif [[ "$services" == "none" ]]; then
        continue
      elif [[ "$services" == "ci-only" ]]; then
        # CI-only modules don't affect runtime services
        add_affected_service "_ci" "module:$module"
      else
        # Space-separated list of services
        for svc in $services; do
          add_affected_service "$svc" "module:$module"
        done
      fi
    else
      # Unknown module, treat as potentially affecting all
      for svc in "${ALL_SERVICES[@]}"; do
        add_affected_service "$svc" "unknown:$module"
      done
    fi
  fi

  # Environment main.tf changes affect everything
  if [[ "$file" == "terraform/environments/dev/main.tf" ]]; then
    for svc in "${ALL_SERVICES[@]}"; do
      add_affected_service "$svc" "env-config"
    done
  fi
done <<< "$tf_changed_files"

# Output affected services (sorted, excluding _ci marker)
for svc in "${!affected_services[@]}"; do
  if [[ "$svc" != "_ci" ]]; then
    echo "$svc:${affected_services[$svc]}"
  fi
done | sort
