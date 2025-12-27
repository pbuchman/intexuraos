# 2-4: Add Cloud Build Configuration

## Tier

2 (Dependent)

## Context

Cloud Build scripts for deploying the new service.

## Problem Statement

Need Cloud Build configuration for:

- Deploy script for mobile-notifications-service
- Update detect-affected.mjs to include the new service

## Scope

- Create `cloudbuild/scripts/deploy-mobile-notifications-service.sh`
- Update `cloudbuild/scripts/detect-affected.mjs` if needed
- Follow existing patterns from other services

## Non-Scope

- Terraform (separate task)
- Service implementation

## Required Approach

1. Copy existing deploy script (e.g., deploy-whatsapp-service.sh)
2. Adapt for mobile-notifications-service
3. Ensure detect-affected.mjs includes the new service path

## Step Checklist

- [ ] Create cloudbuild/scripts/deploy-mobile-notifications-service.sh
- [ ] Make script executable (chmod +x)
- [ ] Update detect-affected.mjs if needed
- [ ] Verify script syntax

## Definition of Done

- Deploy script created
- Script is executable
- Follows existing patterns

## Verification Commands

```bash
chmod +x cloudbuild/scripts/deploy-mobile-notifications-service.sh
bash -n cloudbuild/scripts/deploy-mobile-notifications-service.sh  # syntax check
```

## Rollback Plan

Delete the deploy script
