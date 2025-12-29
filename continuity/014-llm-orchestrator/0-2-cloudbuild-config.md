# 0-2: Cloud Build Configuration

**Tier:** 0 - Setup & Infrastructure
**Status:** Pending

## Context

Adding Cloud Build configuration for llm-orchestrator-service automated deployment.

## Problem Statement

The service needs Cloud Build steps for building Docker image, pushing to Artifact Registry, and deploying to Cloud Run.

## Scope

**In Scope:**
- Create `cloudbuild/scripts/deploy-llm-orchestrator-service.sh`
- Update `cloudbuild/cloudbuild.yaml` with build/deploy steps
- Update `cloudbuild/scripts/detect-affected.mjs` with service detection

**Out of Scope:**
- Actual deployment (happens via Cloud Build trigger)
- Secret population (manual step)

## Required Approach

1. Copy deploy script from existing service (e.g., deploy-whatsapp-service.sh)
2. Add parallel build/push/deploy steps to cloudbuild.yaml
3. Update detect-affected.mjs to include llm-orchestrator-service

## Step Checklist

- [ ] Create `cloudbuild/scripts/deploy-llm-orchestrator-service.sh`
- [ ] Make script executable: `chmod +x`
- [ ] Add build-push step for llm-orchestrator-service to cloudbuild.yaml
- [ ] Add deploy step for llm-orchestrator-service to cloudbuild.yaml
- [ ] Update detect-affected.mjs with service path mapping
- [ ] Update fetch-web-secrets step with new secret

## Definition of Done

- [ ] Deploy script is executable and follows existing pattern
- [ ] Cloud Build YAML is valid (no syntax errors)
- [ ] detect-affected.mjs includes new service

## Verification Commands

```bash
# Check script is executable
ls -la cloudbuild/scripts/deploy-llm-orchestrator-service.sh

# Validate YAML (basic syntax check)
cat cloudbuild/cloudbuild.yaml | python3 -c "import yaml, sys; yaml.safe_load(sys.stdin)"

# Check detection script syntax
node --check cloudbuild/scripts/detect-affected.mjs
```

## Rollback Plan

Delete deploy script, revert cloudbuild.yaml and detect-affected.mjs changes.
