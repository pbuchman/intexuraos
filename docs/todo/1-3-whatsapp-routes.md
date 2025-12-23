# 1-3 - WhatsApp Service Routes Coverage (72-76% → 90%)

**Tier:** 1 (Depends on: 0-0-review-exclusions.md, 0-1-test-utility-improvements.md)

---

## Context Snapshot

### Repo Constraints (from .github/copilot-instructions.md)

- Coverage target: 90/85/85/90 (lines/branches/functions/statements)
- Test runner: Vitest with v8 coverage provider
- Architecture: Routes in `src/routes/v1/`
- Mock external systems only
- Use Fastify injection for route testing
- Run `npm run ci` to verify all checks pass

### Coverage Tooling

- Test command: `npm run test:coverage`
- Current coverage:
  - mappingRoutes.ts: 76.89%
  - webhookRoutes.ts: 72.37%
  - shared.ts: 66.66%

---

## Problem Statement

The whatsapp-service routes have coverage below 90%:
- `mappingRoutes.ts` (76.89%): lines 114-227, 285-301
- `webhookRoutes.ts` (72.37%): lines 193-297, 303-333
- `shared.ts` (66.66%): lines 50-51, 100-136

These routes handle user mapping registration and webhook processing.

---

## Scope

### In Scope

- `apps/whatsapp-service/src/routes/v1/mappingRoutes.ts`
- `apps/whatsapp-service/src/routes/v1/webhookRoutes.ts`
- `apps/whatsapp-service/src/routes/v1/shared.ts`
- Creating/extending route test files

### Out of Scope

- Domain usecase logic (covered in 1-1)
- Actual external API calls
- Config loading logic

---

## Required Approach

- **Integration tests** - Test via Fastify injection
- **Mock strategy**:
  - Use fakes for repositories
  - Mock signature validation where needed
  - Test authentication paths
- **Test coverage priorities**:
  1. Mapping CRUD operations
  2. Webhook signature validation
  3. Error response formatting

---

## Steps

1. Read the route source files:

===
cat apps/whatsapp-service/src/routes/v1/mappingRoutes.ts
cat apps/whatsapp-service/src/routes/v1/webhookRoutes.ts
cat apps/whatsapp-service/src/routes/v1/shared.ts
===

2. Read existing tests:

===
cat apps/whatsapp-service/src/__tests__/webhookReceiver.test.ts
cat apps/whatsapp-service/src/__tests__/webhookVerification.test.ts
===

3. Read testUtils to understand app setup:

===
cat apps/whatsapp-service/src/__tests__/testUtils.ts
===

4. Add test cases for mappingRoutes.ts:

   a. **POST /v1/whatsapp/mapping** (create/update):
   - Successful creation
   - Invalid phone numbers format
   - Invalid inbox notes DB ID
   - Unauthenticated request

   b. **GET /v1/whatsapp/mapping** (get):
   - Mapping found
   - Mapping not found
   - Repository error

   c. **DELETE /v1/whatsapp/mapping** (delete):
   - Successful deletion
   - Not found
   - Unauthenticated

5. Add test cases for webhookRoutes.ts:

   a. **POST /v1/webhooks/whatsapp** (webhook):
   - Valid signature, valid payload
   - Invalid signature (401)
   - Valid signature, processing error
   - Status-only webhook (ignored)

   b. **GET /v1/webhooks/whatsapp** (verification):
   - Valid verify token
   - Invalid verify token (403)

6. Add test cases for shared.ts:

   a. **handleValidationError**:
   - Single validation error
   - Multiple validation errors

   b. **Signature validation utilities** (if any exposed)

7. Run coverage:

===
npm run test:coverage 2>&1 | grep -E "mappingRoutes|webhookRoutes|shared.ts"
===

---

## Definition of Done

- [ ] mappingRoutes.ts ≥ 90% line coverage
- [ ] webhookRoutes.ts ≥ 90% line coverage
- [ ] shared.ts ≥ 85% line coverage
- [ ] All HTTP status codes tested
- [ ] `npm run ci` passes
- [ ] No flaky tests introduced

---

## Verification Commands

Check specific file coverage:
===
npm run test:coverage 2>&1 | grep -E "mappingRoutes|webhookRoutes|shared"
===

Run full CI:
===
npm run ci
===

---

## Rollback Plan

If signature validation tests are complex:
1. Focus on happy path first
2. Add signature edge cases incrementally
3. Consider extracting signature logic to a testable unit

