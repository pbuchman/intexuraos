# 0-1: Terraform Module

**Tier:** 0 - Setup & Infrastructure
**Status:** Pending

## Context

Adding Terraform configuration for llm-orchestrator-service Cloud Run deployment, service account, and secrets.

## Problem Statement

The new service needs Cloud Run infrastructure, IAM service account, and Secret Manager secrets configured via Terraform.

## Scope

**In Scope:**
- Create `terraform/modules/llm-orchestrator-service/` module
- Add service account to IAM module
- Add module call in `terraform/environments/dev/main.tf`
- Create required secrets in Secret Manager

**Out of Scope:**
- Cloud Build configuration (0-2)
- Actual secret values (populated manually)

## Required Approach

1. Copy existing Cloud Run module structure (e.g., whatsapp-service)
2. Define variables for region, project_id, environment
3. Create service account with Firestore and Secret Manager access
4. Add secrets: `INTEXURAOS_LLM_ORCHESTRATOR_SERVICE_URL`, `INTEXURAOS_ENCRYPTION_KEY`

## Step Checklist

- [ ] Create `terraform/modules/llm-orchestrator-service/main.tf`
- [ ] Create `terraform/modules/llm-orchestrator-service/variables.tf`
- [ ] Create `terraform/modules/llm-orchestrator-service/outputs.tf`
- [ ] Add service account `intexuraos-llm-orch-svc-{env}` to IAM module
- [ ] Add module call in `terraform/environments/dev/main.tf`
- [ ] Add secret definitions for encryption key and service URL
- [ ] Run `terraform fmt -recursive`
- [ ] Run `terraform validate`

## Definition of Done

- [ ] `terraform fmt -check -recursive` passes
- [ ] `terraform validate` passes
- [ ] Module outputs service URL

## Verification Commands

```bash
cd terraform
terraform fmt -check -recursive
cd environments/dev
terraform validate
terraform plan  # Review planned changes
```

## Rollback Plan

Delete new module directory and revert changes to `main.tf` and IAM module.
