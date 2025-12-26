# Continuity Ledger — WhatsApp Notes Refactor

## Goal (incl. success criteria)

Refactor WhatsApp integration to:

1. Remove all Notion connection dependencies from WhatsApp service
2. Store messages in Firestore (not Notion) — easily fetchable by user identifier
3. Add OTP verification flow research document (no implementation)
4. Webhook accepts only incoming text messages
5. Create WhatsApp Notes view in web app (list messages, delete functionality)
6. Reply to user with message reference after webhook persists message

**Success criteria:**

- `npm run ci` passes
- No Notion-related code/config in whatsapp-service (except for removed files)
- Messages stored in Firestore, retrievable by userId
- New `/whatsapp-notes` route in web app showing user's messages
- Async reply functionality works with message reference

## Constraints / Assumptions

- Europe/Warsaw timezone (research date: 25 Dec 2025)
- Must maintain existing test coverage thresholds (90%+ lines)
- Follow hexagonal architecture: domain → infra → routes
- Result types for all fallible operations
- No cross-app imports; apps depend only on @intexuraos/common

## Key decisions

- Task decomposition: 8 subtasks across 3 tiers
- OTP verification is research-only (no implementation this iteration)
- Text-only message support (no media)
- No pagination for message list (MVP)
- Removed Notion infra folder, notionConnectionRepository, inboxNotesDbId from entire flow

## State

- Done:
  - 0-0-remove-notion-connection.md (Notion infra removed, tests updated)
  - 0-1-otp-verification-research.md (docs/whatsapp-otp.md created)
  - 1-0-firestore-message-storage.md (WhatsAppMessage model, repository, adapter)
  - 1-1-webhook-text-only.md (webhook now rejects non-text with IGNORED status)
  - 1-2-async-reply-with-reference.md (already implemented, uses contextMessageId)
  - 2-0-whatsapp-notes-api.md (GET/DELETE /v1/whatsapp/messages endpoints)
  - 2-1-whatsapp-notes-web-view.md (WhatsAppNotesPage created with list view)
  - 2-2-delete-message-feature.md (delete button with fade animation)
- Now: COMPLETE ✅
- Next: Archive task folder

## Final Verification

- CI passed: 2025-12-25
- All 379 tests passing
- Coverage: 91.24% lines, 82.56% branches (thresholds met)

## Working set

(completed)

## Working set (files / ids / commands)

- `apps/whatsapp-service/src/infra/notion/` — to be removed
- `apps/whatsapp-service/src/infra/firestore/notionConnectionRepository.ts` — to be removed
- `apps/whatsapp-service/src/domain/inbox/usecases/processWhatsAppWebhook.ts` — to be modified
- `apps/whatsapp-service/src/routes/v1/mappingRoutes.ts` — to be modified
- `apps/whatsapp-service/src/routes/v1/webhookRoutes.ts` — to be modified
- `apps/web/src/pages/WhatsAppConnectionPage.tsx` — to be modified
- `docs/whatsapp-todo.md` — to be deprecated/updated
- `docs/notion-inbox.md` — WhatsApp references to be removed
