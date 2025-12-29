# 2-0 - Add Tests for Colocated Infra Adapters

**Tier:** 2 (Depends on: ALL Tier 0 and Tier 1 issues must be complete)

---

## Prerequisites

Before starting this issue, ensure ALL of these are complete:

**Tier 0:**

- [x] `0-0-narrow-coverage-exclusions.md` - Coverage exclusions narrowed, `**/infra/**` documented
- [x] `0-1-common-package-coverage.md` - Common utilities tested
- [x] `0-2-standardize-test-utilities.md` - Test patterns documented

**Tier 1:**

- [x] `1-0-user-service-token-routes.md` - Auth routes tested
- [x] `1-1-user-service-device-routes.md` - Device routes tested
- [x] `1-2-user-service-shared-httpclient.md` - Auth utilities tested
- [x] `1-3-promptvault-usecases.md` - Promptvault use cases tested
- [x] `1-4-whatsapp-webhook-usecase.md` - WhatsApp use case tested
- [x] `1-5-whatsapp-routes.md` - WhatsApp routes tested
- [x] `1-6-whatsapp-config-signature.md` - WhatsApp config tested
- [x] `1-7-notion-service-coverage.md` - Notion service tested
- [x] `1-8-server-initialization.md` - Server startup tested

---

## Context Snapshot

### Repo Constraints (from .github/copilot-instructions.md)

- Coverage target: 90%
- Test runner: Vitest with v8 coverage provider
- Colocated infra in `src/infra/**` for each app
- Mock external systems only (Notion SDK, Firestore SDK, Auth0 SDK)
- Infra was excluded from coverage, now needs tests
- Run `npm run ci` to verify all checks pass

### Coverage Tooling

- Test command: `npm run test:coverage`
- Previous exclusion: `**/infra/**` in vitest.config.ts (narrowed in 0-0)

### Changes from Prior Tiers

- Coverage exclusions narrowed (0-0) - `**/infra/**` should now be more specific
- Test patterns established (0-2) - Use same patterns for infra tests
- Route tests complete (Tier 1) - Infra is now the remaining gap
- Use cases tested (1-3, 1-4) - Domain logic tested, now test adapters

---

## Problem Statement

All infra adapters need tests now that the `**/infra/**` exclusion is narrowed:

- `apps/user-service/src/infra/auth0/` - Auth0 client
- `apps/user-service/src/infra/firestore/` - Token repository
- `apps/promptvault-service/src/infra/notion/` - Prompt API
- `apps/promptvault-service/src/infra/firestore/` - Connection repository
- `apps/notion-service/src/infra/notion/` - Notion API
- `apps/notion-service/src/infra/firestore/` - Connection repository
- `apps/whatsapp-service/src/infra/notion/` - Inbox notes repository
- `apps/whatsapp-service/src/infra/firestore/` - User mapping, events repositories

These contain mapping logic and error handling that should be tested.

---

## Scope

### In Scope

- All `apps/*/src/infra/**` directories
- Verify the `**/infra/**` exclusion was narrowed in 0-0

### Out of Scope

- External SDK behavior (only mock interactions)
- Web app infra

---

## Required Approach

- **Testing style**: Unit tests for adapters with mocked SDK clients
- **Mocking strategy**:
  - Mock `@notionhq/client` Client
  - Mock `@google-cloud/firestore` Firestore
  - Mock Auth0 management client
  - Use patterns established in 0-2 and used in Tier 1 issues
- **Architecture boundaries**: Test adapter logic, not SDK internals

---

## Steps

1. Verify 0-0 narrowed the `**/infra/**` exclusion in vitest.config.ts:

===
cat vitest.config.ts | grep -A 5 "infra"
===

2. If exclusion still exists, narrow it to specific SDK files only

3. Run coverage to see current state:

===
npm run test:coverage
===

4. For each app, create infra test files following patterns from Tier 1:
   - `apps/user-service/src/__tests__/infra/auth0Client.test.ts`
   - `apps/user-service/src/__tests__/infra/authTokenRepository.test.ts`
   - Similar for other apps

5. Add tests focusing on:
   - Data mapping from SDK responses to domain types
   - Error handling and Result wrapping
   - Edge cases in query logic

6. Run verification:

===
npm run test:coverage
npm run ci
===

---

## Definition of Done

- [ ] `**/infra/**` exclusion removed or narrowed to SDK-only files
- [ ] Each infra adapter has ≥ 80% coverage
- [ ] Error handling paths tested
- [ ] Data mapping logic tested
- [ ] `npm run ci` passes

---

## Verification Commands

===
npm run test:coverage
npm run ci
===

---

## Rollback Plan

If infra tests cause CI failures:

1. Re-add specific exclusion for the problematic file
2. Fix tests incrementally per adapter
