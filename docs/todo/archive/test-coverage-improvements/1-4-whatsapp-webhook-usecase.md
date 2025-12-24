# 1-4 - Add Tests for whatsapp-service Webhook Use Case

**Tier:** 1 (Depends on: ALL Tier 0 issues must be complete)

---

## Prerequisites

Before starting this issue, ensure these are complete:

- [x] `0-0-narrow-coverage-exclusions.md` - Coverage config is cleaned up
- [x] `0-1-common-package-coverage.md` - Common utilities are tested
- [x] `0-2-standardize-test-utilities.md` - Test patterns are documented

---

## Context Snapshot

### Repo Constraints (from .github/copilot-instructions.md)

- Coverage target: 90%
- Test runner: Vitest with v8 coverage provider
- Domain logic in `src/domain/**` has no external deps
- Mock external systems only (Notion, Firestore, WhatsApp)
- Run `npm run ci` to verify all checks pass

### Coverage Tooling

- Test command: `npm run test:coverage`
- Test location: `apps/whatsapp-service/src/__tests__/`

### Changes from Tier 0

- Coverage exclusions have been narrowed (see 0-0)
- Test utility patterns documented (see 0-2)
- Fakes in whatsapp-service reviewed (see 0-2)

---

## Problem Statement

Current coverage for `apps/whatsapp-service/src/domain/inbox/usecases/processWhatsAppWebhook.ts`: **27.11%**

Uncovered lines: 144-354, 377-402 (most of the file)

This is the core business logic for processing WhatsApp webhooks and creating inbox notes. Very low coverage.

---

## Scope

### In Scope

- `apps/whatsapp-service/src/domain/inbox/usecases/processWhatsAppWebhook.ts`

### Out of Scope

- Route handlers (have some coverage already)
- Notion/Firestore adapters (Tier 2 issue)
- WhatsApp client (Tier 2 issue)

---

## Required Approach

- **Testing style**: Unit tests for use case function
- **Mocking strategy**:
  - Mock Notion repository for note creation
  - Mock Firestore repositories for user mapping and event tracking
  - Mock WhatsApp message parsing
  - Use fakes established in 0-2
- **Architecture boundaries**: Test domain logic in isolation

---

## Steps

1. Read the use case file:

===
cat apps/whatsapp-service/src/domain/inbox/usecases/processWhatsAppWebhook.ts
===

2. Read existing test patterns and fakes (reviewed in 0-2):

===
cat apps/whatsapp-service/src/**tests**/webhookReceiver.test.ts
cat apps/whatsapp-service/src/**tests**/fakes.ts
===

3. Identify test scenarios for uncovered lines (144-354, 377-402):
   - Message type handling (text, image, audio, etc.)
   - User mapping lookup
   - Note creation in Notion
   - Duplicate event detection
   - Error handling for each step

4. Create or extend test file:
   - `apps/whatsapp-service/src/__tests__/processWhatsAppWebhook.test.ts`

5. Add tests for:
   - Text message processing
   - Media message processing (image, audio, document)
   - User not mapped scenario
   - Duplicate webhook detection
   - Notion API errors
   - Firestore errors

6. Run verification:

===
npm run test:coverage
npm run ci
===

---

## Definition of Done

- [ ] `processWhatsAppWebhook.ts` coverage ≥ 80%
- [ ] All message types tested
- [ ] Error scenarios tested
- [ ] `npm run ci` passes

---

## Verification Commands

===
npm run test:coverage
npm run ci
===

---

## Rollback Plan

If tests are complex due to message parsing:

1. Start with simpler text-only tests
2. Add media tests incrementally
