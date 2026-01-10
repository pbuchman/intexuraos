# 2-0 Terraform Infrastructure

**Tier:** 2 (Dependent/Integrative)

## Context

All code is implemented. Now we need Terraform changes to deploy:

1. Google OAuth secrets for user-service
2. calendar-agent service account and Cloud Run module
3. calendar-agent URL secret for actions-agent

## Problem Statement

Infrastructure must be configured before deployment:

- user-service needs Google OAuth client ID/secret
- calendar-agent needs IAM service account
- calendar-agent needs Cloud Run module
- actions-agent needs CALENDAR_AGENT_URL

## Scope

**In scope:**

- Secret Manager entries for Google OAuth
- IAM service account for calendar-agent
- Cloud Run module for calendar-agent
- Environment variable updates for user-service
- Environment variable updates for actions-agent

**Not in scope:**

- Code changes (completed in Tier 1)
- Actual deployment (next task)

## Required Approach

1. Add secrets to secret-manager module
2. Add calendar-agent service account to IAM module
3. Create calendar-agent Cloud Run module
4. Update user-service with Google OAuth secrets
5. Update actions-agent with CALENDAR_AGENT_URL
6. Validate with `tf fmt` and `tf validate`

## Step Checklist

### Secret Manager

- [ ] Add INTEXURAOS_GOOGLE_OAUTH_CLIENT_ID to secret-manager
- [ ] Add INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET to secret-manager

### IAM

- [ ] Add "calendar-agent" to service_accounts list

### Cloud Run

- [ ] Create calendar-agent module in main.tf
- [ ] Configure env_vars and secret_env_vars
- [ ] Set proper service account

### user-service Updates

- [ ] Add Google OAuth client ID to secret_env_vars
- [ ] Add Google OAuth client secret to secret_env_vars

### actions-agent Updates

- [ ] Add INTEXURAOS_CALENDAR_AGENT_URL to secret_env_vars

### Verification

- [ ] Run `tf fmt -check -recursive` from terraform/
- [ ] Run `tf validate` from terraform/environments/dev/
- [ ] Run `tf plan` to review changes

## Definition of Done

- [ ] All secrets defined in secret-manager
- [ ] calendar-agent service account exists
- [ ] calendar-agent Cloud Run module configured
- [ ] user-service has Google OAuth env vars
- [ ] actions-agent has CALENDAR_AGENT_URL
- [ ] `tf fmt -check -recursive` passes
- [ ] `tf validate` passes
- [ ] `tf plan` shows expected changes

## Verification Commands

```bash
cd terraform
tf fmt -check -recursive
cd environments/dev
tf validate
tf plan
```

Note: Use `tf` alias (not `terraform`) to avoid emulator env var conflicts.

## Rollback Plan

1. Revert Terraform changes
2. `tf plan` to confirm clean state

## Environment Variables Summary

### user-service (additions)

- INTEXURAOS_GOOGLE_OAUTH_CLIENT_ID (secret)
- INTEXURAOS_GOOGLE_OAUTH_CLIENT_SECRET (secret)

### calendar-agent (new service)

- INTEXURAOS_GCP_PROJECT_ID (env_var)
- INTEXURAOS_AUTH_JWKS_URL (secret)
- INTEXURAOS_AUTH_ISSUER (secret)
- INTEXURAOS_AUTH_AUDIENCE (secret)
- INTEXURAOS_INTERNAL_AUTH_TOKEN (secret)
- INTEXURAOS_USER_SERVICE_URL (secret)

### actions-agent (addition)

- INTEXURAOS_CALENDAR_AGENT_URL (secret)

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
