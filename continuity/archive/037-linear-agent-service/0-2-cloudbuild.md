# Task 0-2: Add Cloud Build Configuration

## Tier

0 (Setup/Diagnostics)

## Context

Terraform is configured. Now we need to set up Cloud Build for CI/CD deployment.

## Problem Statement

Need to configure Cloud Build to build and deploy linear-agent service.

## Scope

### In Scope

- Add build/deploy steps to `cloudbuild/cloudbuild.yaml`
- Create `apps/linear-agent/cloudbuild.yaml` for per-service builds
- Create `cloudbuild/scripts/deploy-linear-agent.sh`
- Add to `docker_services` in Terraform Cloud Build module
- Add to `SERVICES` in smart-dispatch.mjs
- Add to `ALL_SERVICES` in detect-tf-changes.sh
- Add to local dev setup (`scripts/dev.mjs`)
- Add to `.envrc.local.example`

### Out of Scope

- Web app Cloud Build updates (only if web calls linear-agent directly)

## Required Approach

1. **Read** existing patterns in `cloudbuild/cloudbuild.yaml`
2. **Add** build and deploy steps following user-service pattern
3. **Create** per-service cloudbuild.yaml
4. **Create** deployment script following pattern in create-service.md
5. **Update** all supporting configuration files

## Step Checklist

- [ ] Add build step to `cloudbuild/cloudbuild.yaml`
- [ ] Add deploy step to `cloudbuild/cloudbuild.yaml`
- [ ] Create `apps/linear-agent/cloudbuild.yaml`
- [ ] Create `cloudbuild/scripts/deploy-linear-agent.sh` (make executable)
- [ ] Add to `docker_services` in `terraform/modules/cloud-build/main.tf`
- [ ] Add to `SERVICES` in `.github/scripts/smart-dispatch.mjs`
- [ ] Add to `ALL_SERVICES` in `scripts/detect-tf-changes.sh`
- [ ] Add to `scripts/dev.mjs` SERVICES array
- [ ] Add env vars to `.envrc.local.example`
- [ ] Test that all config files are valid

## Definition of Done

- All config files updated
- Deploy script is executable
- Smart dispatch includes linear-agent
- Local dev config ready

## Verification Commands

```bash
# Check deploy script exists and is executable
ls -la cloudbuild/scripts/deploy-linear-agent.sh

# Check cloudbuild.yaml exists
ls -la apps/linear-agent/cloudbuild.yaml

# Verify smart-dispatch includes service
grep "linear-agent" .github/scripts/smart-dispatch.mjs

# Verify detect-tf-changes includes service
grep "linear-agent" scripts/detect-tf-changes.sh

# Verify dev.mjs includes service
grep "linear-agent" scripts/dev.mjs

# Verify terraform cloud-build includes service
grep "linear-agent" terraform/modules/cloud-build/main.tf
```

## Rollback Plan

```bash
git checkout cloudbuild/cloudbuild.yaml
git checkout terraform/modules/cloud-build/main.tf
git checkout .github/scripts/smart-dispatch.mjs
git checkout scripts/detect-tf-changes.sh
git checkout scripts/dev.mjs
rm cloudbuild/scripts/deploy-linear-agent.sh
rm apps/linear-agent/cloudbuild.yaml
```

## Reference Files

- `.claude/commands/create-service.md` (Section 8, 9)
- `cloudbuild/cloudbuild.yaml` - See user-service pattern
- `apps/calendar-agent/cloudbuild.yaml`
- `cloudbuild/scripts/deploy-calendar-agent.sh`

## cloudbuild/cloudbuild.yaml additions

```yaml
# ===== linear-agent =====
- name: 'gcr.io/cloud-builders/docker'
  id: 'build-push-linear-agent'
  waitFor: ['-']
  entrypoint: 'bash'
  args:
    ['cloudbuild/scripts/build-push-monitored.sh', 'linear-agent', 'apps/linear-agent/Dockerfile']
  env:
    - 'DOCKER_BUILDKIT=1'
    - 'ARTIFACT_REGISTRY_URL=${_ARTIFACT_REGISTRY_URL}'
    - 'COMMIT_SHA=$COMMIT_SHA'

- name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
  id: 'deploy-linear-agent'
  waitFor: ['build-push-linear-agent']
  entrypoint: 'bash'
  args: ['-c', 'bash cloudbuild/scripts/deploy-linear-agent.sh']
  env:
    - 'COMMIT_SHA=$COMMIT_SHA'
    - 'REGION=${_REGION}'
    - 'ARTIFACT_REGISTRY_URL=${_ARTIFACT_REGISTRY_URL}'
    - 'ENVIRONMENT=${_ENVIRONMENT}'
```

## apps/linear-agent/cloudbuild.yaml

```yaml
# Manual trigger: Deploy linear-agent only
steps:
  - name: 'gcr.io/cloud-builders/docker'
    id: 'build'
    entrypoint: 'bash'
    args:
      ['cloudbuild/scripts/build-push-monitored.sh', 'linear-agent', 'apps/linear-agent/Dockerfile']
    env:
      - 'DOCKER_BUILDKIT=1'
      - 'ARTIFACT_REGISTRY_URL=${_ARTIFACT_REGISTRY_URL}'
      - 'COMMIT_SHA=$COMMIT_SHA'

  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    id: 'deploy'
    entrypoint: 'bash'
    args: ['-c', 'bash cloudbuild/scripts/deploy-linear-agent.sh']
    env:
      - 'COMMIT_SHA=$COMMIT_SHA'
      - 'REGION=${_REGION}'
      - 'ARTIFACT_REGISTRY_URL=${_ARTIFACT_REGISTRY_URL}'
      - 'ENVIRONMENT=${_ENVIRONMENT}'

options:
  logging: CLOUD_LOGGING_ONLY
  machineType: E2_HIGHCPU_8

timeout: '600s'
```

## cloudbuild/scripts/deploy-linear-agent.sh

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=cloudbuild/scripts/lib.sh
source "${SCRIPT_DIR}/lib.sh"

SERVICE="linear-agent"
CLOUD_RUN_SERVICE="intexuraos-linear-agent"

require_env_vars REGION ARTIFACT_REGISTRY_URL COMMIT_SHA

tag="$(deployment_tag)"
image="${ARTIFACT_REGISTRY_URL}/${SERVICE}:${tag}"

log "Deploying ${SERVICE} to Cloud Run"
log "  Environment: ${ENVIRONMENT:-unset}"
log "  Region: ${REGION}"
log "  Image: ${image}"

# Check if service exists (must be created by Terraform first)
if ! gcloud run services describe "$CLOUD_RUN_SERVICE" --region="$REGION" &>/dev/null; then
  log "ERROR: Service ${CLOUD_RUN_SERVICE} does not exist"
  log "Run 'terraform apply' in terraform/environments/dev/ first to create the service with proper configuration"
  exit 1
fi

gcloud run deploy "$CLOUD_RUN_SERVICE" \
  --image="$image" \
  --region="$REGION" \
  --platform=managed \
  --quiet

log "Deployment complete for ${SERVICE}"
```

## scripts/dev.mjs addition

```javascript
{ name: 'linear-agent', port: 8119, color: '\x1b[95m' },  // Light magenta
```

## .envrc.local.example addition

```bash
# Linear Agent Service
export INTEXURAOS_LINEAR_AGENT_URL=http://localhost:8119
```

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
