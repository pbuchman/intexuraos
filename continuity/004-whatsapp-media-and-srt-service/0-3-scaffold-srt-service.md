# 0-3: Scaffold srt-service with Terraform

**Tier:** 0 (Infrastructure Setup)

---

## Context

srt-service is a new Cloud Run service for speech transcription via Speechmatics. It needs:
- Dedicated service account
- Internal-only ingress (no public access)
- min_scale = 1 (for background polling worker)
- max_scale = 1 (cost control)
- Speechmatics API key secret

---

## Problem Statement

Create the infrastructure for srt-service following existing service patterns:
- Service account with Firestore, Secret Manager, Logging access
- Cloud Run service with internal ingress
- Speechmatics API key in Secret Manager
- roles/run.invoker granted only to whatsapp-service SA (for potential direct calls; primary flow is Pub/Sub)

---

## Scope

**In scope:**
- Add srt_service to `locals.services`
- Create service account in IAM module
- Add `INTEXURAOS_SPEECHMATICS_API_KEY` secret
- Create Cloud Run module call with `allow_unauthenticated = false`
- Add `invoker_service_accounts` variable to cloud-run-service module
- Grant run.invoker to whatsapp-service SA
- Scaffold `apps/srt-service/` directory structure (package.json, tsconfig, src/)
- Add to root tsconfig.json project references
- Update api-docs-hub env vars

**Out of scope:**
- Application logic (later tasks)
- Pub/Sub subscription (already in 0-2)

---

## Required Approach

1. Update `locals.services` with srt_service config
2. Add service account to IAM module
3. Add secret to secret-manager module
4. Extend cloud-run-service module for invoker_service_accounts
5. Add module call for srt-service
6. Scaffold app directory
7. Update root tsconfig.json
8. Update api-docs-hub

---

## Step Checklist

- [ ] Add srt_service to locals.services (min_scale=1, max_scale=1)
- [ ] Add google_service_account.srt_service in IAM module
- [ ] Add srt_service to service_accounts output
- [ ] Add INTEXURAOS_SPEECHMATICS_API_KEY to secrets
- [ ] Add Firestore, Logging IAM for srt_service
- [ ] Add Secret Manager IAM for srt_service
- [ ] Add invoker_service_accounts variable to cloud-run-service module
- [ ] Add IAM binding for run.invoker when invoker_service_accounts is set
- [ ] Add module "srt_service" in dev/main.tf
- [ ] Create apps/srt-service/package.json
- [ ] Create apps/srt-service/tsconfig.json
- [ ] Create apps/srt-service/Dockerfile
- [ ] Create apps/srt-service/src/index.ts (minimal)
- [ ] Create apps/srt-service/src/server.ts (minimal)
- [ ] Create apps/srt-service/src/config.ts
- [ ] Add project reference to root tsconfig.json
- [ ] Add SRT_SERVICE_OPENAPI_URL to api-docs-hub env_vars
- [ ] Add srt_service_url output
- [ ] Run terraform fmt
- [ ] Run terraform validate

---

## Definition of Done

- srt-service infrastructure fully defined in Terraform
- Service account with correct permissions
- App scaffold compiles (minimal)
- api-docs-hub updated
- Terraform validates

---

## Verification Commands

```bash
cd terraform/environments/dev
terraform fmt -check -recursive
terraform validate

cd /path/to/repo
npm run typecheck
```

---

## Rollback Plan

Remove srt_service from locals, IAM, secrets, and module calls. Delete apps/srt-service/.

