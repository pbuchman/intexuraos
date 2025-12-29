# 8-4: Terraform Validation

**Tier:** 8 - Integration & Testing
**Status:** Pending

## Context

Final validation of all Terraform configuration.

## Problem Statement

Terraform must pass formatting and validation checks.

## Scope

**In Scope:**
- terraform fmt check
- terraform validate
- Review plan output (if possible)

**Out of Scope:**
- Actual apply (requires environment access)

## Required Approach

1. Run formatting check
2. Run validation
3. Review any warnings

## Step Checklist

- [ ] Run `terraform fmt -check -recursive` from terraform/
- [ ] Run `terraform validate` from terraform/environments/dev/
- [ ] Fix any formatting issues
- [ ] Fix any validation errors
- [ ] Review terraform plan output if possible

## Definition of Done

- [ ] `terraform fmt -check -recursive` passes
- [ ] `terraform validate` passes
- [ ] No warnings or errors

## Verification Commands

```bash
cd terraform
terraform fmt -check -recursive
cd environments/dev
terraform init -backend=false  # Skip backend for validation
terraform validate
```

## Rollback Plan

Fix Terraform files based on validation errors.

---

## ARCHIVAL

After this task completes successfully:

1. Move `continuity/014-llm-orchestrator/` to `continuity/archive/014-llm-orchestrator/`
2. Update CONTINUITY.md with final status
3. Only then mark task as COMPLETE
