# 1-0: notion-service Changes

**Tier**: 1 (Independent Deliverable)
**Dependencies**: 0-0-verify-current-state

## Context

Move `notion_connections` ownership to notion-service and add internal API endpoint for service-to-service communication.

## Problem

Currently `notionConnection.ts` is in shared package `@intexuraos/infra-notion` and includes `promptVaultPageId` which is promptvault-specific, not Notion-specific.

## Scope

**In Scope:**

- Move `notionConnection.ts` to `apps/notion-service/src/infra/firestore/notionConnectionRepository.ts`
- Remove `promptVaultPageId` from `NotionConnectionPublic` and `NotionConnectionDoc`
- Create internal endpoint `/internal/notion/users/:userId/context`
- Update `connectNotion()` usecase to not accept `promptVaultPageId`
- Write tests for internal endpoint

**Out of Scope:**

- Changes to promptvault-service
- Changes to shared package (handled in 1-2)

## Approach

1. Copy `notionConnection.ts` to notion-service with modifications
2. Remove all references to `promptVaultPageId`
3. Create `internalRoutes.ts` with `validateInternalAuth()` and endpoint
4. Register internal routes in server
5. Update `connectNotion.ts` usecase (remove `promptVaultPageId` parameter)
6. Update `integrationRoutes.ts` (remove `promptVaultPageId` from request body)
7. Write comprehensive tests

## Steps

- [ ] Copy and modify `notionConnectionRepository.ts` (remove `promptVaultPageId`)
- [ ] Update `apps/notion-service/src/infra/firestore/index.ts` to export from local file
- [ ] Create `apps/notion-service/src/routes/internalRoutes.ts`
- [ ] Update `apps/notion-service/src/routes/index.ts` - export `internalRoutes`
- [ ] Update `apps/notion-service/src/routes/routes.ts` - register `internalRoutes`
- [ ] Update `apps/notion-service/src/domain/integration/usecases/connectNotion.ts`
- [ ] Update `apps/notion-service/src/routes/integrationRoutes.ts`
- [ ] Create `apps/notion-service/src/__tests__/internalRoutes.test.ts`
- [ ] Update existing tests to remove `promptVaultPageId` assertions
- [ ] Run `npm run ci` for notion-service

## Definition of Done

- `notion_connections` structure has no `promptVaultPageId` field
- Endpoint `/internal/notion/users/:userId/context` returns `{ connected, token }`
- Internal endpoint protected by `X-Internal-Auth` header
- All tests pass
- `connectNotion()` usecase updated

## Verification

```bash
# Tests should pass
npm run ci

# Endpoint should exist
grep -r "/internal/notion" apps/notion-service/src/routes/

# promptVaultPageId should be gone from repository
! grep "promptVaultPageId" apps/notion-service/src/infra/firestore/notionConnectionRepository.ts
```

## Rollback

```bash
git checkout apps/notion-service/
```

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
