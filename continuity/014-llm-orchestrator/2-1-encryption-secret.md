# 2-1: Encryption Secret

**Tier:** 2 - Encryption Infrastructure + User Service Extension
**Status:** Pending

## Context

Add encryption key secret to Terraform configuration.

## Problem Statement

The encryption utility needs a secret key stored in Secret Manager.

## Scope

**In Scope:**
- Add `INTEXURAOS_ENCRYPTION_KEY` secret to Terraform
- Grant user-service access to the secret
- Document secret generation process

**Out of Scope:**
- Actual secret value generation (manual step)
- Key rotation mechanism

## Required Approach

1. Add secret definition in Terraform
2. Add IAM binding for user-service service account
3. Document how to generate and populate the secret

## Step Checklist

- [ ] Add secret `INTEXURAOS_ENCRYPTION_KEY` to secrets module
- [ ] Add IAM binding for user-service access
- [ ] Add IAM binding for llm-orchestrator-service access (future)
- [ ] Run `terraform fmt -recursive`
- [ ] Run `terraform validate`
- [ ] Document secret generation: `openssl rand -base64 32`

## Definition of Done

- [ ] `terraform fmt -check -recursive` passes
- [ ] `terraform validate` passes
- [ ] Secret accessible by required services

## Verification Commands

```bash
cd terraform
terraform fmt -check -recursive
cd environments/dev
terraform validate
```

## Rollback Plan

Remove secret definition and IAM bindings from Terraform.
