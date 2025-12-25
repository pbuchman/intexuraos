# 0-0 Remove Notion Connection from WhatsApp Service

**Tier:** 0 (Prerequisite)  
**Status:** Pending

## Context Snapshot

The whatsapp-service currently:
- Has `src/infra/notion/` folder with `inboxNotesRepository.ts` for writing to Notion
- Has `src/infra/firestore/notionConnectionRepository.ts` for fetching Notion tokens
- Uses `NotionConnectionRepositoryAdapter` in services.ts
- `processWhatsAppWebhook.ts` use case writes to Notion via `InboxNotesRepository`
- `mappingRoutes.ts` requires `inboxNotesDbId` (Notion database ID) during connection
- `WhatsAppConnectionPage.tsx` has form field for Notion database ID
- `docs/whatsapp-todo.md` references Notion integration extensively

## Problem Statement

Notion connection is being deprecated for WhatsApp. Messages should be stored in Firestore, not Notion. All Notion-related code, configuration, and documentation must be removed from the WhatsApp integration flow.

## Scope

**In scope:**
- Delete `apps/whatsapp-service/src/infra/notion/` folder
- Delete `apps/whatsapp-service/src/infra/firestore/notionConnectionRepository.ts`
- Remove `NotionConnectionRepositoryAdapter` from `services.ts` and `adapters.ts`
- Remove `inboxNotesDbId` from user mapping (domain, infra, routes)
- Update `WhatsAppConnectionPage.tsx` to remove Notion database ID field
- Update/deprecate `docs/whatsapp-todo.md`
- Remove Notion references from `docs/notion-inbox.md` related to WhatsApp

**Out of scope:**
- Implementing new Firestore message storage (separate task)
- OTP verification (separate task)
- Web view for messages (separate task)

## Required Approach

1. Delete Notion infra files
2. Update domain models to remove `inboxNotesDbId`
3. Update Firestore user mapping repository
4. Update routes to not require `inboxNotesDbId`
5. Update web page form
6. Update webhook processing to skip Notion write (stub for now)
7. Update/remove documentation
8. Fix all broken tests

## Step Checklist

- [ ] Delete `apps/whatsapp-service/src/infra/notion/` folder
- [ ] Delete `apps/whatsapp-service/src/infra/firestore/notionConnectionRepository.ts`
- [ ] Update `apps/whatsapp-service/src/infra/firestore/index.ts` exports
- [ ] Remove `NotionConnectionRepositoryAdapter` from `adapters.ts`
- [ ] Remove from `ServiceContainer` in `services.ts`
- [ ] Update `WhatsAppUserMappingPublic` interface (remove `inboxNotesDbId`)
- [ ] Update `saveUserMapping` function signature
- [ ] Update `UserMappingRepositoryAdapter` in `adapters.ts`
- [ ] Update `mappingRoutes.ts` — remove `inboxNotesDbId` from schema and handler
- [ ] Update `webhookRoutes.ts` — remove Notion token lookup and write
- [ ] Update `processWhatsAppWebhook.ts` use case — remove Notion dependency
- [ ] Update domain ports/repositories interfaces
- [ ] Update `WhatsAppConnectionPage.tsx` — remove Notion database ID form field
- [ ] Update web services/types if needed
- [ ] Update/deprecate `docs/whatsapp-todo.md`
- [ ] Update `docs/notion-inbox.md` — remove WhatsApp references
- [ ] Fix all affected tests
- [ ] Run `npx prettier --write .`
- [ ] Run `npm run ci`

## Definition of Done

- No Notion-related code in whatsapp-service (infra/notion folder deleted)
- No `notionConnectionRepository` in firestore
- No `inboxNotesDbId` in user mapping flow
- WhatsApp connection page works without Notion database ID
- Webhook receives messages but does not attempt Notion write
- All tests pass
- `npm run ci` passes

## Verification Commands

===
npm run ci
===

## Rollback Plan

Git revert to previous commit. No database migrations involved — Firestore documents remain unchanged (we're only removing code that reads/writes them).

