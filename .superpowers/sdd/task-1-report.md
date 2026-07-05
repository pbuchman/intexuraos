# Task 1 Report: Add Year-Bearing Transcript Message Dates for INT-1852

## Summary

Implemented year-bearing transcript date labels and added `importedAt` to projected private conversation context messages and the internal conversation-context route contract.

## Files Changed

- `apps/whatsapp-service/src/domain/conversation-assistant/transcriptFormatting.ts`
- `apps/whatsapp-service/src/__tests__/domain/conversation-assistant/transcriptFormatting.test.ts`
- `apps/whatsapp-service/src/domain/whatsapp/models/PrivateWhatsApp.ts`
- `apps/whatsapp-service/src/routes/privateSyncRoutes.ts`
- `apps/whatsapp-service/src/__tests__/privateSyncRoutes.test.ts`
- `.superpowers/sdd/task-1-report.md`

## TDD Evidence

### RED

1. Transcript formatter focused test:

   Command:
   `pnpm exec vitest run apps/whatsapp-service/src/__tests__/domain/conversation-assistant/transcriptFormatting.test.ts --reporter=verbose`

   Observed failures:
   - projected messages were missing `importedAt`
   - transcript text still rendered as `[Unknown date] ...` instead of `[Sent Unknown date; imported Unknown date] ...`

   Key failure lines:
   - `expected [ { id: 'message-1', … } ] to deeply equal [ { id: 'message-1', …, importedAt: '2026-06-22T10:00:02.000Z' } ]`
   - `Expected: "[Sent Unknown date; imported Unknown date] Alice: invalid timestamp text"`
   - `Received: "[Unknown date] Alice: invalid timestamp text"`

2. Conversation-context route focused test:

   Command:
   `pnpm exec vitest run apps/whatsapp-service/src/__tests__/privateSyncRoutes.test.ts --reporter=verbose`

   Observed failure:
   - exported message DTO omitted `importedAt`

   Key failure line:
   - `expected { eventTimestamp: '2026-06-22T10:00:00.000Z' } to match object { eventTimestamp: '2026-06-22T10:00:00.000Z', importedAt: ... }`

### GREEN

1. Transcript formatter focused test:

   Command:
   `pnpm exec vitest run apps/whatsapp-service/src/__tests__/domain/conversation-assistant/transcriptFormatting.test.ts --reporter=verbose`

   Result:
   - `Test Files  1 passed (1)`
   - `Tests  11 passed (11)`

2. Conversation-context route focused test:

   Command:
   `pnpm exec vitest run apps/whatsapp-service/src/__tests__/privateSyncRoutes.test.ts --reporter=verbose`

   Result:
   - `Test Files  1 passed (1)`
   - `Tests  106 passed (106)`

## Verification Run

1. Targeted workspace verification:

   Command:
   `pnpm run verify:workspace:tracked whatsapp-service`

   Result:
   - `=== All checks passed for whatsapp-service ===`

2. Full tracked CI:

   Command:
   `pnpm run ci:tracked`

   Result:
   - `[test:coverage] ✓ 5381 tests passed`
   - `✅ CI passed`

## Implementation Notes

- Added `importedAt` to `PrivateConversationContextMessage` in both projection and shared model definitions.
- Copied `message.ingestedAt` into projected context messages.
- Updated transcript formatting to emit:
  - `Sent <day month year>`
  - `imported <day month year>`
- Preserved `Unknown date` fallback for invalid timestamps.
- Updated the internal Fastify response schema so `importedAt` is required and `additionalProperties: false` remains intact.
- Adjusted route assertions to compare `importedAt` against the repository-stored `ingestedAt`, because the internal ingest path stamps this dynamically at write time.

## Self-Review

- Scope stayed within the owned files plus the required task report.
- The implementation is minimal and follows the existing projection/schema pattern.
- The route test now validates the real contract without assuming a fixed ingestion clock.
- Coverage and tracked CI remained green after the contract change.
