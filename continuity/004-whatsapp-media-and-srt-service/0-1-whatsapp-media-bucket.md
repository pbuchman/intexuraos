# 0-1: Create WhatsApp Media Bucket Terraform Module

**Tier:** 0 (Infrastructure Setup)

---

## Context

WhatsApp media (images, audio) must be stored in a private GCS bucket. Access is controlled via IAM + signed URLs. No public access, no directory listing.

---

## Problem Statement

Need a dedicated, secure GCS bucket for WhatsApp media files with:

- Uniform bucket-level access (IAM only, no ACLs)
- No public access
- whatsapp-service has objectAdmin role
- No lifecycle rules in phase 1 (retain until user deletes)

---

## Scope

**In scope:**

- Create `terraform/modules/whatsapp-media-bucket/`
- main.tf, variables.tf, outputs.tf
- IAM binding for whatsapp-service SA
- Wire module in `terraform/environments/dev/main.tf`
- Add bucket name as env var to whatsapp-service

**Out of scope:**

- Application code to use the bucket
- Signed URL generation logic

---

## Required Approach

1. Create module directory
2. Define bucket with uniform access, no public read
3. Add IAM binding for whatsapp-service objectAdmin
4. Wire in dev environment
5. Add WHATSAPP_MEDIA_BUCKET env var to whatsapp-service module
6. Add output for bucket name

---

## Step Checklist

- [ ] Create `terraform/modules/whatsapp-media-bucket/main.tf`
- [ ] Create `terraform/modules/whatsapp-media-bucket/variables.tf`
- [ ] Create `terraform/modules/whatsapp-media-bucket/outputs.tf`
- [ ] Add module call in `terraform/environments/dev/main.tf`
- [ ] Add `env_vars.WHATSAPP_MEDIA_BUCKET` to whatsapp_service module
- [ ] Add output `whatsapp_media_bucket_name`
- [ ] Run terraform fmt
- [ ] Run terraform validate

---

## Definition of Done

- Module creates private bucket with uniform access
- whatsapp-service has objectAdmin role on bucket
- Bucket name passed to whatsapp-service as env var
- Terraform validates successfully

---

## Verification Commands

```bash
cd terraform/environments/dev
terraform fmt -check -recursive
terraform validate
```

---

## Rollback Plan

Remove module call from dev/main.tf, delete module directory.
