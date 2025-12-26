# 0-0: Enforce max_scale = 1 for all existing services

**Tier:** 0 (Setup/Infrastructure)

---

## Context

All Cloud Run services should have `max_scale = 1` for cost control during development phase. This ensures predictable costs and resource usage.

---

## Problem Statement

Current services may have `max_scale = 2` or higher. Need to audit and enforce `max_scale = 1` across all existing services before adding new infrastructure.

---

## Scope

**In scope:**
- Audit `locals.services` in `terraform/environments/dev/main.tf`
- Set `max_scale = 1` for all services
- Verify Terraform plan shows expected changes

**Out of scope:**
- Production environment (if exists)
- New services (handled in later tasks)

---

## Required Approach

1. Read `terraform/environments/dev/main.tf`
2. Update `locals.services` to set `max_scale = 1` for each service
3. Run `terraform fmt` and `terraform validate`

---

## Step Checklist

- [ ] Update auth_service max_scale to 1
- [ ] Update promptvault_service max_scale to 1
- [ ] Update notion_service max_scale to 1
- [ ] Update whatsapp_service max_scale to 1
- [ ] Update api_docs_hub max_scale to 1
- [ ] Run terraform fmt
- [ ] Run terraform validate

---

## Definition of Done

- All services in `locals.services` have `max_scale = 1`
- `terraform fmt -check -recursive` passes
- `terraform validate` passes

---

## Verification Commands

```bash
cd terraform/environments/dev
terraform fmt -check -recursive
terraform validate
```

---

## Rollback Plan

Revert `max_scale` values to previous settings in `locals.services`.

