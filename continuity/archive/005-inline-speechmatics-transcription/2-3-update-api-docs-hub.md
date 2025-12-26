# 2-3: Update api-docs-hub

**Tier:** 2 (Dependent/Integrative)

**Depends on:** 1-2

## Context Snapshot

`apps/api-docs-hub/src/config.ts` has `SRT_SERVICE_OPENAPI_URL` in REQUIRED_ENV_VARS. Since srt-service is deleted, this needs removal.

## Problem Statement

Remove srt-service from API docs hub configuration.

## Scope

**In scope:**

- `apps/api-docs-hub/src/config.ts`

**Out of scope:**

- Terraform env vars (2-4)

## Required Approach

1. Remove SRT_SERVICE_OPENAPI_URL from REQUIRED_ENV_VARS array
2. Verify no other srt-service references

## Step Checklist

- [ ] Remove SRT_SERVICE_OPENAPI_URL from REQUIRED_ENV_VARS in config.ts
- [ ] Search for other srt-service references in api-docs-hub
- [ ] Run `npm run typecheck`

## Definition of Done

- No reference to SRT_SERVICE_OPENAPI_URL
- TypeScript compiles

## Verification Commands

```bash
npm run typecheck
grep -r "SRT_SERVICE" apps/api-docs-hub/ && echo "FAIL" || echo "OK: No SRT_SERVICE references"
```

## Rollback Plan

```bash
git checkout -- apps/api-docs-hub/src/config.ts
```
