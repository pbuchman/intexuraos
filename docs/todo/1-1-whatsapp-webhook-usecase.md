# 1-1 - WhatsApp Webhook UseCase Coverage (27% → 85%)

**Tier:** 1 (Depends on: 0-0-review-exclusions.md, 0-1-test-utility-improvements.md)

---

## Context Snapshot

### Repo Constraints (from .github/copilot-instructions.md)

- Coverage target: 90/85/85/90 (lines/branches/functions/statements)
- Test runner: Vitest with v8 coverage provider
- Architecture: Domain usecases in `src/domain/*/usecases/`
- Mock external systems only (Notion for inbox notes)
- Assert observable behavior, not implementation
- Run `npm run ci` to verify all checks pass

### Coverage Tooling

- Test command: `npm run test:coverage`
- Current coverage: processWhatsAppWebhook.ts at 27.11%
- Uncovered lines: 144-354, 377-402 (most of the file)

---

## Problem Statement

`apps/whatsapp-service/src/domain/inbox/usecases/processWhatsAppWebhook.ts` has only 27.11% line coverage. This is the core business logic for processing WhatsApp webhooks and creating inbox notes.

The uncovered sections include:
- Webhook payload parsing
- Message type handling (text, image, audio, etc.)
- User mapping lookups
- Inbox note creation
- Error handling paths

---

## Scope

### In Scope

- `apps/whatsapp-service/src/domain/inbox/usecases/processWhatsAppWebhook.ts`
- Creating/extending `apps/whatsapp-service/src/__tests__/processWhatsAppWebhook.test.ts`
- Using existing fakes from `fakes.ts`

### Out of Scope

- Route integration tests (covered by 1-3)
- Actual Notion API calls
- Changes to the usecase logic

---

## Required Approach

- **Unit tests** - Test the usecase function directly
- **Mock strategy**:
  - Use `FakeWhatsAppWebhookEventRepository` for event storage
  - Use `FakeWhatsAppUserMappingRepository` for user mappings
  - Mock or fake `InboxNotesRepository`
- **Test coverage priorities**:
  1. Valid text message webhook processing
  2. Non-text message types (ignored scenarios)
  3. Invalid payload structures
  4. User not found scenarios
  5. Repository error handling

---

## Steps

1. Read the source file to understand all branches:

===
cat apps/whatsapp-service/src/domain/inbox/usecases/processWhatsAppWebhook.ts
===

2. Read existing test file if any:

===
cat apps/whatsapp-service/src/__tests__/processWhatsAppWebhook.test.ts 2>/dev/null || echo "File not found"
===

3. Read the fakes to understand available mock implementations:

===
cat apps/whatsapp-service/src/__tests__/fakes.ts
===

4. Create test file with the following test cases:

   a. **Payload validation tests**:
   - Invalid object type (not "whatsapp_business_account")
   - Missing entry array
   - Missing changes array
   - Invalid messaging_product

   b. **Message type tests**:
   - Text message → creates inbox note
   - Image message → ignored (not text)
   - Status update → ignored (not message)

   c. **Phone number validation**:
   - Allowed phone number ID → processed
   - Disallowed phone number ID → ignored

   d. **User mapping tests**:
   - User found → creates note
   - User not found → ignored
   - Repository error → failure

   e. **Inbox note creation**:
   - Successful creation
   - Repository error during creation

5. Ensure each test uses the fake repositories properly

6. Run coverage to verify improvement:

===
npm run test:coverage 2>&1 | grep "processWhatsAppWebhook"
===

---

## Definition of Done

- [ ] processWhatsAppWebhook.ts line coverage ≥ 85%
- [ ] processWhatsAppWebhook.ts branch coverage ≥ 75%
- [ ] All message types have test cases
- [ ] Error paths explicitly tested
- [ ] `npm run ci` passes
- [ ] No flaky tests introduced

---

## Verification Commands

Check specific file coverage:
===
npm run test:coverage 2>&1 | grep "processWhatsAppWebhook\|AppWebhook"
===

Run full CI:
===
npm run ci
===

---

## Rollback Plan

If tests become flaky or hard to maintain:
1. Focus on the most critical paths (text message processing)
2. Document edge cases that are too complex to test
3. Consider refactoring the usecase if it's too monolithic

