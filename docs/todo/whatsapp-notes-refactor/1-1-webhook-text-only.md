# 1-1 Webhook Text-Only Support

**Tier:** 1 (Independent)  
**Status:** Pending  
**Depends on:** 0-0 (Notion removal complete)

## Context Snapshot

Current webhook handler accepts various message types from WhatsApp (text, image, video, audio, document). The use case `processWhatsAppWebhook.ts` classifies these and marks non-text as IGNORED with reason `UNSUPPORTED_MESSAGE_TYPE`.

Requirement: webhook should **only** support incoming text messages. Other message types should be rejected cleanly.

## Problem Statement

Simplify webhook to:
1. Only accept text messages
2. Return clear response for unsupported types
3. No exceptions for other message types

## Scope

**In scope:**
- Update webhook classification logic
- Update domain InboxNote model (remove non-text message types)
- Update webhook response for unsupported types
- Update tests

**Out of scope:**
- Handling media messages (explicitly not supported)
- Voice transcription (future feature)

## Required Approach

### Classification Changes

In `processWhatsAppWebhook.ts`, update `classifyWebhook` to:
- Check message type early
- Return IGNORED with clear reason for non-text
- Only proceed for `type === 'text'`

### Domain Model Updates

Update `InboxMessageType` in domain:
===
// Before: Text, Image, Video, Audio, Document, Mixed
// After: Text only (or remove the type entirely since it's always Text)
===

### Response Behavior

When non-text message received:
- Log the rejection
- Save webhook event with status IGNORED
- Return 200 OK (Meta requires 200 for all webhooks)
- Do NOT send reply to user (silent rejection)

## Step Checklist

- [ ] Update `InboxMessageType` in domain model (or remove if always Text)
- [ ] Update `classifyWebhook` in use case to reject non-text early
- [ ] Update webhook route handler to handle non-text gracefully
- [ ] Remove any code paths for non-text message processing
- [ ] Update tests for text-only behavior
- [ ] Add tests for non-text rejection
- [ ] Run `npx prettier --write .`
- [ ] Run `npm run ci`

## Definition of Done

- Webhook only processes text messages
- Non-text messages are logged and ignored (no error to Meta)
- Domain model simplified for text-only
- Tests verify text-only behavior
- Tests verify non-text rejection
- `npm run ci` passes

## Verification Commands

===
npm run ci
npm run test:coverage
===

## Rollback Plan

Git revert. No database changes.

