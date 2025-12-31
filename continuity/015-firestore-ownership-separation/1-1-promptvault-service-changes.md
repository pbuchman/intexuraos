# 1-1: promptvault-service Changes

**Tier**: 1 (Independent Deliverable)
**Dependencies**: 0-0-verify-current-state

## Context

Create new `promptvault_settings` collection for promptVaultPageId and implement HTTP client to fetch Notion token from notion-service.

## Problem

Currently promptvault-service directly accesses `notion_connections` Firestore collection. Need to:

1. Store `promptVaultPageId` in own collection
2. Fetch Notion token via HTTP from notion-service

## Scope

**In Scope:**

- Create `promptVaultSettingsRepository.ts` with new Firestore collection
- Create `notionServiceClient.ts` for HTTP calls to notion-service
- Update `promptApi.ts` to use both repositories
- Update `services.ts` DI container
- Update `promptRoutes.ts` for `/prompt-vault/main-page` endpoint
- Create `FakeNotionServiceClient` for tests
- Write comprehensive tests

**Out of Scope:**

- Changes to notion-service (handled in 1-0)
- Changes to shared package (handled in 1-2)

## Approach

1. Create new Firestore repository for `promptvault_settings`
2. Create HTTP client for notion-service with proper error handling
3. Update `getUserContext()` to fetch from both sources in parallel
4. Wire up dependencies in DI container
5. Update route that manually orchestrates connection checks
6. Write tests with fake implementations

## Steps

- [ ] Create `apps/promptvault-service/src/infra/firestore/promptVaultSettingsRepository.ts`
- [ ] Create `apps/promptvault-service/src/infra/notion/notionServiceClient.ts`
- [ ] Update `apps/promptvault-service/src/infra/notion/promptApi.ts`
  - Modify `getUserContext()` to use HTTP client + settings repo
  - Propagate dependencies to createPrompt, listPrompts, getPrompt, updatePrompt
- [ ] Update `apps/promptvault-service/src/services.ts`
  - Add `notionServiceClient` to `ServiceContainer`
  - Initialize client with `NOTION_SERVICE_URL` and `INTERNAL_AUTH_TOKEN`
- [ ] Update `apps/promptvault-service/src/routes/promptRoutes.ts`
  - Use `getPromptVaultPageId()` instead of `connectionRepository.getConnection()`
  - Use `notionServiceClient.getNotionToken()` instead of repository
- [ ] Update `apps/promptvault-service/src/__tests__/fakes.ts`
  - Add `FakeNotionServiceClient`
  - Add fake settings repository
- [ ] Delete `apps/promptvault-service/src/infra/firestore/index.ts` (only re-exported from package)
- [ ] Create tests for `notionServiceClient.ts` (with nock)
- [ ] Create tests for `promptVaultSettingsRepository.ts`
- [ ] Update existing tests to use new fakes
- [ ] Run `npm run ci` for promptvault-service

## Definition of Done

- `promptvault_settings` collection functions exist
- `notionServiceClient` calls `/internal/notion/users/:userId/context`
- `getUserContext()` fetches from both sources
- All prompt operations work with new dependencies
- All tests pass with fake implementations
- No direct Firestore access to `notion_connections`

## Verification

```bash
# Tests should pass
npm run ci

# No direct imports of notion connection functions
! grep "getNotionConnection\|getNotionToken\|isNotionConnected" apps/promptvault-service/src/infra/notion/promptApi.ts

# Client exists
grep -r "createNotionServiceClient" apps/promptvault-service/src/

# Settings repository exists
grep -r "promptvault_settings" apps/promptvault-service/src/
```

## Rollback

```bash
git checkout apps/promptvault-service/
```

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
