# 2-4: Update Terraform IAM and Secrets

**Tier:** 2 (Dependent/Integrative)

**Depends on:** 1-2, 1-5

## Context Snapshot

Terraform needs:

1. Remove srt_service from locals.services
2. Remove module "srt_service" Cloud Run deployment
3. Remove srt_service service account from IAM module
4. Remove srt_service from whatsapp-media-bucket IAM
5. Add INTEXURAOS_SPEECHMATICS_API_KEY to whatsapp-service secrets
6. Update api-docs-hub env_vars to remove SRT_SERVICE_OPENAPI_URL
7. Remove depends_on references to srt_service

## Problem Statement

Remove all srt-service infrastructure and add Speechmatics secret to whatsapp-service.

## Scope

**In scope:**

- `terraform/environments/dev/main.tf`
- `terraform/modules/iam/main.tf`
- `terraform/modules/iam/outputs.tf`
- `terraform/modules/whatsapp-media-bucket/main.tf`
- `terraform/modules/whatsapp-media-bucket/variables.tf`

**Out of scope:**

- Pub/Sub changes (1-5, already done)

## Required Approach

1. Remove srt_service from locals.services
2. Delete module "srt_service" block
3. Update api-docs-hub module to remove SRT_SERVICE_OPENAPI_URL env var
4. Update api-docs-hub depends_on to remove srt_service
5. Add INTEXURAOS_SPEECHMATICS_API_KEY to whatsapp_service secrets
6. Update IAM module to remove srt_service account
7. Update whatsapp-media-bucket to remove srt_service references

## Step Checklist

- [ ] Remove srt_service from locals.services in main.tf
- [ ] Remove module "srt_service" in main.tf
- [ ] Remove SRT_SERVICE_OPENAPI_URL from api_docs_hub env_vars
- [ ] Remove module.srt_service from api_docs_hub depends_on
- [ ] Add INTEXURAOS_SPEECHMATICS_API_KEY to whatsapp_service secrets
- [ ] Remove srt_service service account from modules/iam/main.tf
- [ ] Remove srt_service from modules/iam/outputs.tf
- [ ] Remove srt_service references from modules/whatsapp-media-bucket/
- [ ] Run `terraform fmt -recursive`
- [ ] Run `terraform validate`

## Definition of Done

- No reference to srt_service in terraform
- INTEXURAOS_SPEECHMATICS_API_KEY in whatsapp-service secrets
- `terraform validate` passes

## Verification Commands

```bash
cd terraform
grep -r "srt_service" . && echo "FAIL" || echo "OK: No srt_service"
grep -r "srt-service" . && echo "FAIL" || echo "OK: No srt-service"
grep "SPEECHMATICS" environments/dev/main.tf && echo "OK: Speechmatics secret present"
terraform fmt -check -recursive
terraform validate
```

## Rollback Plan

```bash
git checkout -- terraform/
```
