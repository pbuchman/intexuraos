# 0-0: Create app-settings-service

## Status: ✅ DONE

## Tier: 0 (Setup)

## Context

Nowy serwis do zarządzania ustawieniami aplikacji, począwszy od LLM pricing.

## Problem

Brak centralnego źródła prawdy dla konfiguracji — pricing rozproszony po klientach.

## Scope

- Struktura katalogów apps/app-settings-service/
- Dockerfile
- Terraform module
- CloudBuild script
- Service account
- Basic health endpoint

## Non-Scope

- Endpoint pricing (task 1-1)
- Firestore collections (task 0-1)

## Approach

Użyj .claude/commands/create-service.md jako template.

## Steps

- [x] Create apps/app-settings-service/ directory structure
- [x] Create package.json with dependencies
- [x] Create Dockerfile
- [x] Create src/index.ts, src/server.ts, src/config.ts, src/services.ts
- [x] Create basic routes/healthRoutes.ts
- [x] Add Terraform module in terraform/environments/dev/main.tf
- [x] Add service account to IAM module
- [x] Create cloudbuild/scripts/deploy-app-settings-service.sh
- [x] Add to cloudbuild/cloudbuild.yaml \_SERVICE_CONFIGS
- [x] Add to scripts/dev.mjs (port 8122)
- [x] Add to root tsconfig.json references
- [x] Add to .envrc.local.example

## Definition of Done

- [x] npm run ci passes
- [x] terraform validate passes
- [x] Service starts locally with npm run dev

## Created Files

- apps/app-settings-service/package.json
- apps/app-settings-service/Dockerfile
- apps/app-settings-service/tsconfig.json
- apps/app-settings-service/src/index.ts
- apps/app-settings-service/src/server.ts
- apps/app-settings-service/src/services.ts
- apps/app-settings-service/src/domain/ports/index.ts
- apps/app-settings-service/src/infra/firestore/index.ts (FirestorePricingRepository)
- apps/app-settings-service/src/routes/internalRoutes.ts
- apps/app-settings-service/src/**tests**/routes/internalRoutes.test.ts
- apps/app-settings-service/src/**tests**/infra/FirestorePricingRepository.test.ts
- cloudbuild/scripts/deploy-app-settings-service.sh
- terraform/environments/dev/main.tf (updated)

## Verification

```bash
npm run ci
cd terraform && tf fmt -check -recursive && tf validate
npm run dev -w @intexuraos/app-settings-service
```

## Rollback

Remove apps/app-settings-service/ and Terraform changes.

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to 0-1-migration-011-pricing-structure.md.
