#!/usr/bin/env bash
set -euo pipefail

# Configuration
PROJECT="intexuraos-dev-pbuchman"
REGION="europe-central2"

SERVICES=(
  "intexuraos-user-service"
  "intexuraos-promptvault-service"
  "intexuraos-notion-service"
  "intexuraos-whatsapp-service"
  "intexuraos-mobile-notifications-service"
  "intexuraos-api-docs-hub"
  "intexuraos-llm-orchestrator"
)

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
GRAY='\033[0;90m'
BOLD='\033[1m'
NC='\033[0m' # No Color

log() { echo -e "${GRAY}[$(date +'%H:%M:%S')]${NC} $*"; }
success() { echo -e "${GREEN}✓${NC} $*"; }
warning() { echo -e "${YELLOW}⚠${NC} $*"; }
error() { echo -e "${RED}✗${NC} $*"; }
header() { echo -e "\n${BOLD}━━━ $* ━━━${NC}"; }

# Format ISO date (UTC) to human readable local time
format_date() {
  local iso_date="$1"
  # macOS: convert UTC to local time
  if TZ=UTC date -j -f "%Y-%m-%dT%H:%M:%S" "${iso_date%%.*}" "+%s" &>/dev/null; then
    local epoch
    epoch=$(TZ=UTC date -j -f "%Y-%m-%dT%H:%M:%S" "${iso_date%%.*}" "+%s")
    date -r "$epoch" "+%b %d %H:%M"
    return
  fi
  # Linux: date -d handles timezone conversion
  date -d "$iso_date" "+%b %d %H:%M" 2>/dev/null || echo "$iso_date"
}

# Global PR number (set by get_git_state)
PR_NUMBER=""

# 1. Check gcloud authentication
check_gcloud_auth() {
  header "Checking gcloud authentication"

  if ! command -v gcloud &>/dev/null; then
    error "gcloud CLI not installed"
    echo "Install: https://cloud.google.com/sdk/docs/install"
    exit 1
  fi

  if ! gcloud auth print-identity-token &>/dev/null; then
    error "Not authenticated to gcloud"
    echo "Run: gcloud auth login"
    exit 1
  fi
  success "gcloud authenticated"

  # Verify project access
  if ! gcloud projects describe "$PROJECT" &>/dev/null; then
    error "Cannot access project: $PROJECT"
    exit 1
  fi
  success "Project access verified: $PROJECT"
}

# 2. Check GitHub CLI authentication
check_gh_auth() {
  header "Checking GitHub CLI authentication"
  if ! command -v gh &>/dev/null; then
    error "GitHub CLI not installed"
    echo "Install: brew install gh"
    exit 1
  fi
  if ! gh auth token &>/dev/null; then
    error "Not authenticated to GitHub CLI"
    echo "Run: gh auth login"
    exit 1
  fi
  success "GitHub CLI authenticated"
}

# 3. Check Terraform configuration
check_terraform() {
  header "Checking Terraform"

  if ! command -v terraform &>/dev/null; then
    error "Terraform not installed"
    echo "Install: brew install terraform"
    exit 1
  fi

  local tf_dir="terraform/environments/dev"
  if [[ ! -d "$tf_dir" ]]; then
    error "Terraform directory not found: $tf_dir"
    exit 1
  fi

  if ! terraform -chdir="$tf_dir" validate &>/dev/null; then
    error "Terraform validation failed"
    terraform -chdir="$tf_dir" validate
    exit 1
  fi
  success "Terraform configuration valid"
}

# 4. Get current git state
get_git_state() {
  header "Current Git State"
  local branch commit msg
  branch=$(git branch --show-current)
  commit=$(git rev-parse --short HEAD)
  msg=$(git log -1 --format=%s)

  echo "Branch: $branch"
  echo "Commit: $commit"
  echo "Message: $msg"

  if [[ "$branch" != "development" ]]; then
    warning "Not on development branch (current: $branch)"
  fi

  # Check for open PR
  local pr_info
  pr_info=$(gh pr list --head "$branch" --json number,url -q '.[0] | "\(.number)\t\(.url)"' 2>/dev/null || echo "")
  if [[ -n "$pr_info" ]]; then
    PR_NUMBER=$(echo "$pr_info" | cut -f1)
    local pr_url
    pr_url=$(echo "$pr_info" | cut -f2)
    success "PR #$PR_NUMBER open - $pr_url"
  else
    warning "No PR open from this branch"
  fi
}

# 5. Check GitHub Actions CI
check_github_ci() {
  header "GitHub Actions CI Status"

  if [[ -z "$PR_NUMBER" ]]; then
    warning "No PR to check CI status for"
    return
  fi

  local checks
  checks=$(gh pr checks "$PR_NUMBER" --json name,state,bucket 2>/dev/null || echo "[]")

  if [[ "$checks" == "[]" ]]; then
    warning "No CI checks found for PR #$PR_NUMBER"
    return
  fi

  echo "$checks" | jq -r '.[] | "\(.state)\t\(.bucket)\t\(.name)"' | \
  while IFS=$'\t' read -r state bucket name; do
    if [[ "$state" == "SUCCESS" ]]; then
      success "$name"
    elif [[ "$state" == "PENDING" || "$state" == "QUEUED" || "$state" == "IN_PROGRESS" ]]; then
      warning "$name - ${state,,}"
    elif [[ "$state" == "SKIPPED" ]]; then
      echo "  $name - skipped"
    else
      error "$name - $state"
    fi
  done
}

# 6. Check Cloud Build status
check_cloud_build() {
  header "Cloud Build Status"

  local builds
  builds=$(gcloud builds list --project="$PROJECT" --region="$REGION" --limit=5 \
    --format="json(id,createTime,duration,status,substitutions.COMMIT_SHA)" 2>/dev/null || echo "[]")

  if [[ "$builds" == "[]" ]]; then
    warning "No Cloud Builds found"
    return
  fi

  echo "$builds" | jq -r '.[] | "\(.status)\t\(.substitutions.COMMIT_SHA // "unknown")\t\(.id)\t\(.createTime)"' | \
  while IFS=$'\t' read -r status sha build_id created; do
    local short_sha="${sha:0:7}"
    local commit_msg formatted_date build_url
    commit_msg=$(git log -1 --format=%s "$sha" 2>/dev/null || echo "")
    formatted_date=$(format_date "$created")
    build_url="https://console.cloud.google.com/cloud-build/builds;region=$REGION/$build_id?project=$PROJECT"

    if [[ "$status" == "SUCCESS" ]]; then
      success "$short_sha - $commit_msg ($formatted_date)"
      echo "    $build_url"
    elif [[ "$status" == "WORKING" || "$status" == "QUEUED" ]]; then
      warning "$short_sha - in progress ($formatted_date)"
      echo "    $build_url"
    else
      error "$short_sha - FAILURE - $commit_msg ($formatted_date)"
      echo "    $build_url"
    fi
  done
}

# 6. Stream Cloud Build logs until completion
stream_cloud_build() {
  local build_id="$1"

  header "Streaming Cloud Build Logs"
  echo "Build: https://console.cloud.google.com/cloud-build/builds;region=$REGION/$build_id?project=$PROJECT"
  echo ""

  # Stream logs until build completes (requires beta for Cloud Logging)
  gcloud beta builds log "$build_id" --project="$PROJECT" --region="$REGION" --stream 2>&1

  # Check final status
  local final_status
  final_status=$(gcloud builds describe "$build_id" --project="$PROJECT" --region="$REGION" \
    --format="value(status)" 2>/dev/null || echo "UNKNOWN")

  echo ""
  if [[ "$final_status" == "SUCCESS" ]]; then
    success "Cloud Build completed successfully"
    return 0
  else
    error "Cloud Build failed: $final_status"
    return 1
  fi
}

# 8. Check Cloud Run services health
check_services_health() {
  header "Cloud Run Services Health"

  for svc in "${SERVICES[@]}"; do
    local ready revision last_deployed formatted_date
    ready=$(gcloud run services describe "$svc" --project="$PROJECT" --region="$REGION" \
      --format="value(status.conditions[0].status)" 2>/dev/null || echo "Unknown")

    revision=$(gcloud run services describe "$svc" --project="$PROJECT" --region="$REGION" \
      --format="value(status.latestReadyRevisionName)" 2>/dev/null || echo "")

    if [[ -n "$revision" ]]; then
      last_deployed=$(gcloud run revisions describe "$revision" --project="$PROJECT" --region="$REGION" \
        --format="value(metadata.creationTimestamp)" 2>/dev/null || echo "")
      formatted_date=$(format_date "$last_deployed")
    else
      formatted_date="Unknown"
    fi

    local short_name="${svc#intexuraos-}"
    if [[ "$ready" == "True" ]]; then
      success "$short_name ($formatted_date)"
    else
      error "$short_name - $ready"
    fi
  done
}

# Main
main() {
  echo -e "${BOLD}╔════════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}║  IntexuraOS Deployment Verification Tool   ║${NC}"
  echo -e "${BOLD}╚════════════════════════════════════════════╝${NC}"

  check_gcloud_auth
  check_gh_auth
  check_terraform
  get_git_state
  check_github_ci
  check_cloud_build

  # If latest build is in progress, stream its logs until completion
  local latest_build
  latest_build=$(gcloud builds list --project="$PROJECT" --region="$REGION" --limit=1 \
    --format="value(id,status)" 2>/dev/null || echo "")

  local build_id build_status
  build_id=$(echo "$latest_build" | cut -f1)
  build_status=$(echo "$latest_build" | cut -f2)

  if [[ "$build_status" == "WORKING" || "$build_status" == "QUEUED" ]]; then
    stream_cloud_build "$build_id"
  fi

  check_services_health

  header "Verification Complete"
}

main "$@"
