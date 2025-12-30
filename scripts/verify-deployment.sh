#!/usr/bin/env bash
set -euo pipefail

# Configuration
PROJECT="intexuraos-dev-pbuchman"
REGION="europe-central2"
TIMEOUT_MINUTES=5
POLL_INTERVAL=15

SERVICES=(
  "intexuraos-user-service"
  "intexuraos-promptvault-service"
  "intexuraos-notion-service"
  "intexuraos-whatsapp-service"
  "intexuraos-mobile-notifications-service"
  "intexuraos-api-docs-hub"
  "intexuraos-llm-orchestrator-service"
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

# 1. Check gcloud authentication
check_gcloud_auth() {
  header "Checking gcloud authentication"
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
  if ! gh auth status &>/dev/null; then
    error "Not authenticated to GitHub CLI"
    echo "Run: gh auth login"
    exit 1
  fi
  success "GitHub CLI authenticated"
}

# 3. Get current git state
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
}

# 4. Check GitHub Actions CI
check_github_ci() {
  header "GitHub Actions CI Status"

  local repo_owner repo_name
  repo_owner=$(gh repo view --json owner -q '.owner.login' 2>/dev/null || echo "")
  repo_name=$(gh repo view --json name -q '.name' 2>/dev/null || echo "")

  if [[ -z "$repo_owner" || -z "$repo_name" ]]; then
    warning "Could not determine repository info"
    return
  fi

  local ci_runs
  ci_runs=$(gh run list --repo "$repo_owner/$repo_name" --branch development --limit 3 \
    --json status,conclusion,name,headSha,createdAt 2>/dev/null || echo "[]")

  if [[ "$ci_runs" == "[]" ]]; then
    warning "No CI runs found for development branch"
    return
  fi

  echo "$ci_runs" | jq -r '.[] | "\(.status)\t\(.conclusion // "running")\t\(.name)\t\(.headSha[0:7])\t\(.createdAt)"' | \
  while IFS=$'\t' read -r status conclusion name sha created; do
    if [[ "$conclusion" == "success" ]]; then
      success "$name ($sha) - $conclusion"
    elif [[ "$status" == "in_progress" ]]; then
      warning "$name ($sha) - in progress"
    else
      error "$name ($sha) - ${conclusion:-$status}"
    fi
  done
}

# 5. Check Cloud Build status
check_cloud_build() {
  header "Cloud Build Status"

  local builds
  builds=$(gcloud builds list --project="$PROJECT" --region="$REGION" --limit=5 \
    --format="json(id,createTime,duration,status,substitutions.COMMIT_SHA)" 2>/dev/null || echo "[]")

  if [[ "$builds" == "[]" ]]; then
    warning "No Cloud Builds found"
    return
  fi

  echo "$builds" | jq -r '.[] | "\(.status)\t\(.substitutions.COMMIT_SHA // "unknown")[0:7]\t\(.duration // "?")\t\(.createTime)"' | \
  while IFS=$'\t' read -r status sha duration created; do
    local short_sha="${sha:0:7}"
    local short_time
    short_time=$(echo "$created" | grep -oE '[0-9]{2}:[0-9]{2}:[0-9]{2}' | head -1)
    if [[ "$status" == "SUCCESS" ]]; then
      success "Build $short_sha - $status ($duration) at $short_time"
    elif [[ "$status" == "WORKING" || "$status" == "QUEUED" ]]; then
      warning "Build $short_sha - $status (in progress)"
    else
      error "Build $short_sha - $status"
    fi
  done
}

# 6. Wait for Cloud Build completion
wait_for_cloud_build() {
  header "Waiting for Cloud Build"

  local start_time=$SECONDS
  local timeout=$((TIMEOUT_MINUTES * 60))

  while (( SECONDS - start_time < timeout )); do
    local latest_status
    latest_status=$(gcloud builds list --project="$PROJECT" --region="$REGION" --limit=1 \
      --format="value(status)" 2>/dev/null || echo "UNKNOWN")

    if [[ "$latest_status" == "SUCCESS" ]]; then
      success "Cloud Build completed successfully"
      return 0
    elif [[ "$latest_status" == "FAILURE" || "$latest_status" == "CANCELLED" ]]; then
      error "Cloud Build failed: $latest_status"
      return 1
    fi

    log "Build status: $latest_status - waiting ${POLL_INTERVAL}s..."
    sleep "$POLL_INTERVAL"
  done

  error "Timeout waiting for Cloud Build"
  return 1
}

# 7. Check Cloud Run services health
check_services_health() {
  header "Cloud Run Services Health"

  for svc in "${SERVICES[@]}"; do
    local ready revision last_deployed
    ready=$(gcloud run services describe "$svc" --project="$PROJECT" --region="$REGION" \
      --format="value(status.conditions[0].status)" 2>/dev/null || echo "Unknown")

    revision=$(gcloud run services describe "$svc" --project="$PROJECT" --region="$REGION" \
      --format="value(status.latestReadyRevisionName)" 2>/dev/null || echo "")

    if [[ -n "$revision" ]]; then
      last_deployed=$(gcloud run revisions describe "$revision" --project="$PROJECT" --region="$REGION" \
        --format="value(metadata.creationTimestamp)" 2>/dev/null || echo "Unknown")
    else
      last_deployed="Unknown"
    fi

    local short_name="${svc#intexuraos-}"
    if [[ "$ready" == "True" ]]; then
      success "$short_name - Ready (deployed: $last_deployed)"
    else
      error "$short_name - $ready"
    fi
  done
}

# 8. Show recent deployment info
show_deployment_info() {
  header "Recent Deployments"

  for svc in "${SERVICES[@]}"; do
    local revision
    revision=$(gcloud run services describe "$svc" --project="$PROJECT" --region="$REGION" \
      --format="value(status.latestReadyRevisionName)" 2>/dev/null || echo "")

    if [[ -n "$revision" ]]; then
      local created image image_sha
      created=$(gcloud run revisions describe "$revision" --project="$PROJECT" --region="$REGION" \
        --format="value(metadata.creationTimestamp)" 2>/dev/null || echo "")
      image=$(gcloud run revisions describe "$revision" --project="$PROJECT" --region="$REGION" \
        --format="value(spec.containers[0].image)" 2>/dev/null || echo "")

      # Extract commit SHA from image tag (format: ...:<sha>)
      image_sha=$(echo "$image" | grep -oE ':[a-f0-9]+$' | tr -d ':' | head -c7)

      local short_name="${svc#intexuraos-}"
      if [[ -n "$image_sha" ]]; then
        local commit_msg
        commit_msg=$(git log -1 --format=%s "$image_sha" 2>/dev/null || echo "unknown commit")
        echo "$short_name: $image_sha - $commit_msg"
        echo "  Deployed: $created"
      else
        echo "$short_name: deployed at $created"
      fi
    fi
  done
}

# 9. Show recent logs
show_recent_logs() {
  header "Recent Error Logs (last 5 min)"

  # Calculate timestamp for 5 minutes ago (macOS compatible)
  local since_time
  if date -v-5M '+%Y-%m-%dT%H:%M:%SZ' &>/dev/null; then
    # macOS
    since_time=$(date -u -v-5M '+%Y-%m-%dT%H:%M:%SZ')
  else
    # Linux
    since_time=$(date -u -d '5 minutes ago' '+%Y-%m-%dT%H:%M:%SZ')
  fi

  local found_errors=false
  for svc in "${SERVICES[@]}"; do
    local errors
    errors=$(gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=$svc AND severity>=ERROR AND timestamp>=\"$since_time\"" \
      --project="$PROJECT" --limit=3 --format="value(textPayload)" 2>/dev/null || echo "")

    if [[ -n "$errors" ]]; then
      found_errors=true
      local short_name="${svc#intexuraos-}"
      error "Errors in $short_name:"
      echo "$errors" | head -5
      echo ""
    fi
  done

  if [[ "$found_errors" == "false" ]]; then
    success "No errors found in the last 5 minutes"
  fi
}

# Main
main() {
  echo -e "${BOLD}╔════════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}║  IntexuraOS Deployment Verification Tool   ║${NC}"
  echo -e "${BOLD}╚════════════════════════════════════════════╝${NC}"

  check_gcloud_auth
  check_gh_auth
  get_git_state
  check_github_ci
  check_cloud_build

  # If latest build is in progress, wait for it
  local latest_status
  latest_status=$(gcloud builds list --project="$PROJECT" --region="$REGION" --limit=1 \
    --format="value(status)" 2>/dev/null || echo "")

  if [[ "$latest_status" == "WORKING" || "$latest_status" == "QUEUED" ]]; then
    wait_for_cloud_build
  fi

  check_services_health
  show_deployment_info
  show_recent_logs

  header "Verification Complete"
}

main "$@"
