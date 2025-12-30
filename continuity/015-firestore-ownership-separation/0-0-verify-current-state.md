# 0-0: Verify Current State

**Tier**: 0 (Setup/Diagnostics)
**Dependencies**: None

## Context

Before making changes, verify current usage of `notion_connections` collection and `promptVaultPageId` field across the codebase.

## Problem

Need baseline understanding of:
1. Where `notionConnection.ts` functions are currently used
2. Which files reference `promptVaultPageId`
3. Current test coverage that will need updating

## Scope

**In Scope:**
- Search for all usages of `promptVaultPageId` string literal
- Identify all imports from `@intexuraos/infra-notion` related to connections
- List all test files that reference Notion connections

**Out of Scope:**
- Making any changes
- Modifying code

## Approach

1. Search for `promptVaultPageId` across codebase
2. Search for imports of `saveNotionConnection`, `getNotionConnection`, etc.
3. Identify test files that will need updates
4. Document findings in this file

## Steps

- [ ] Search for `promptVaultPageId` string
- [ ] Search for `NotionConnectionPublic` interface usage
- [ ] Search for function imports from infra-notion
- [ ] List affected test files
- [ ] Document findings below

## Definition of Done

- All current usages documented
- Baseline established for verification after changes
- No code changes made

## Verification

```bash
# Should find references (before changes)
grep -r "promptVaultPageId" apps/ packages/
```

## Rollback

N/A - read-only task

---

## Findings

### promptVaultPageId Usage Summary

**Total occurrences**: ~70+ across codebase

**Files with promptVaultPageId (source code, non-test):**

**notion-service:**
- `src/domain/integration/ports/ConnectionRepository.ts` - interface definition
- `src/domain/integration/usecases/connectNotion.ts` - usecase accepts and validates
- `src/domain/integration/usecases/getNotionStatus.ts` - returns in status
- `src/domain/integration/usecases/disconnectNotion.ts` - returns in response
- `src/services.ts` - DI wiring
- `src/server.ts` - OpenAPI schema

**promptvault-service:**
- `src/domain/promptvault/ports/NotionPorts.ts` - port interface
- `src/infra/notion/promptApi.ts` - uses getNotionConnection() to get pageId
- `src/routes/promptRoutes.ts` - manual connection checks
- `src/services.ts` - DI wiring
- `src/infra/firestore/index.ts` - re-exports from @intexuraos/infra-notion

**shared package:**
- `packages/infra-notion/src/notionConnection.ts` - repository with promptVaultPageId field

### Import Analysis

**Files importing from @intexuraos/infra-notion:**
1. `apps/notion-service/src/infra/firestore/index.ts` - re-exports connection functions
2. `apps/notion-service/src/infra/notion/index.ts` - re-exports Notion API client
3. `apps/notion-service/src/services.ts` - imports NotionLogger type
4. `apps/notion-service/src/server.ts` - imports NotionLogger type
5. `apps/promptvault-service/src/infra/firestore/index.ts` - re-exports connection functions
6. `apps/promptvault-service/src/infra/notion/index.ts` - re-exports Notion API functions
7. `apps/promptvault-service/src/infra/notion/promptApi.ts` - imports Notion client + connection functions
8. `apps/promptvault-service/src/services.ts` - imports NotionLogger type
9. `apps/promptvault-service/src/server.ts` - imports NotionLogger type

### Key Observation

promptVaultPageId is deeply integrated into:
1. **notion-service**: Accepts it in connectNotion, stores it, returns it in status
2. **promptvault-service**: Reads it from Firestore via getNotionConnection()
3. **shared package**: Defined in NotionConnectionPublic interface

### Impact Assessment

**High impact changes needed:**
- Remove promptVaultPageId from NotionConnectionPublic interface
- Update connectNotion() usecase (remove parameter)
- Update integrationRoutes.ts (remove from request body)
- Create new promptvault_settings repository
- Update all notion-service tests
- Update all promptvault-service code to use new repository

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
