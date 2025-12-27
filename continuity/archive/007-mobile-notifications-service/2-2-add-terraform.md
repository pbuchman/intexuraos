# 2-2: Add Terraform Configuration

## Tier

2 (Dependent)

## Context

Infrastructure as code for the new service.

## Problem Statement

Need Terraform configuration for:

- Cloud Run service
- Service account
- IAM bindings
- Firestore access

## Scope

- Add service to terraform/environments/dev/main.tf
- Add to locals.services map
- Create Cloud Run module call
- Add service account to IAM module
- Add outputs

## Non-Scope

- Production environment (dev only for now)
- Cloud Build (separate task)

## Required Approach

Follow existing pattern from other services (e.g., whatsapp-service).

## Environment Variables in Terraform

Must configure these env vars for the Cloud Run service:

- `INTEXURAOS_AUTH_JWKS_URL`
- `INTEXURAOS_AUTH_ISSUER`
- `INTEXURAOS_AUTH_AUDIENCE`
- `PROJECT_ID`

## Step Checklist

- [ ] Add service to locals.services in main.tf
- [ ] Create Cloud Run module call with env vars
- [ ] Add service account to IAM
- [ ] Add outputs for service URL
- [ ] Run terraform fmt
- [ ] Run terraform validate

## Definition of Done

- Terraform configuration complete
- `terraform fmt -check -recursive` passes
- `terraform validate` passes

## Verification Commands

```bash
cd terraform/environments/dev
terraform fmt -recursive
terraform fmt -check -recursive
terraform validate
```

## Rollback Plan

Revert terraform changes
