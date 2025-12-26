# 1-2: Delete srt-service

**Tier:** 1 (Independent Deliverable)

## Context Snapshot

`apps/srt-service/` is a standalone transcription service that needs to be completely removed.

## Problem Statement

Delete the entire srt-service application as its functionality is being moved into whatsapp-service.

## Scope

**In scope:**
- Delete `apps/srt-service/` directory entirely
- Remove from root `tsconfig.json` references
- Remove deploy script `cloudbuild/scripts/deploy-srt-service.sh`

**Out of scope:**
- Terraform changes (1-5, 2-4)
- api-docs-hub changes (2-3)

## Required Approach

1. Delete the entire apps/srt-service directory
2. Remove tsconfig.json project reference
3. Remove deploy script
4. Verify no dangling imports

## Step Checklist

- [ ] Delete `apps/srt-service/` directory
- [ ] Remove srt-service from `tsconfig.json` references
- [ ] Delete `cloudbuild/scripts/deploy-srt-service.sh`
- [ ] Search for remaining `srt-service` references in code
- [ ] Run `npm run typecheck`

## Definition of Done

- `apps/srt-service/` does not exist
- No tsconfig.json reference to srt-service
- No deploy script for srt-service
- TypeScript compiles (may have errors in whatsapp-service until 1-3 done)

## Verification Commands

```bash
ls apps/srt-service 2>&1 | grep "No such file"
grep -r "srt-service" tsconfig.json || echo "Not found - OK"
ls cloudbuild/scripts/deploy-srt-service.sh 2>&1 | grep "No such file"
```

## Rollback Plan

```bash
git checkout -- apps/srt-service/
git checkout -- tsconfig.json
git checkout -- cloudbuild/scripts/deploy-srt-service.sh
```

