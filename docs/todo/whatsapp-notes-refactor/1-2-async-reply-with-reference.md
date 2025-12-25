# 1-2 Async Reply with Message Reference

**Tier:** 1 (Independent)  
**Status:** Pending  
**Depends on:** 0-0 (Notion removal), 1-0 (Message storage)

## Context Snapshot

Current `whatsappClient.ts` has `sendWhatsAppMessage` function that supports:

- Sending text messages
- Optional `contextMessageId` parameter for replies

Requirement: When a message is accepted and persisted, reply asynchronously to the user WITH A REFERENCE to the message they sent (i.e., as a reply to their message).

## Problem Statement

After webhook persists a message:

1. Send confirmation reply to user
2. Reply should reference the original message (WhatsApp threading)
3. Must be async (don't block webhook response)

## Scope

**In scope:**

- Update async webhook processing to send reply
- Use `contextMessageId` to create threaded reply
- Confirmation message text
- Error handling (don't fail if reply fails)

**Out of scope:**

- Notification for failed saves (just log)
- Custom message templates

## Required Approach

### Reply Logic

In `webhookRoutes.ts` `processWebhookAsync`:

===
// After successfully saving message to Firestore:
const waMessageId = extractMessageId(request.body);
const fromNumber = extractSenderPhoneNumber(request.body);

if (waMessageId && fromNumber) {
const replyResult = await sendWhatsAppMessage(
config.phoneNumberId,
fromNumber,
'✅ Your note has been saved.',
config.accessToken,
waMessageId // This creates a reply to the original message
);

if (!replyResult.success) {
request.log.warn({ error: replyResult.error }, 'Failed to send confirmation reply');
}
}
===

### Message Text

Keep it simple:

- Success: `✅ Your note has been saved.`
- Could be configurable later, but hardcode for now

### Error Handling

- If reply fails, log warning but don't fail the overall process
- Message is already saved, reply is best-effort
- Don't retry automatically (avoid spam)

## Step Checklist

- [ ] Identify where message is successfully saved in async processing
- [ ] Add reply logic after successful save
- [ ] Use `contextMessageId` (waMessageId from payload)
- [ ] Add appropriate logging
- [ ] Handle reply failures gracefully
- [ ] Write tests for reply flow
- [ ] Mock WhatsApp API in tests
- [ ] Run `npx prettier --write .`
- [ ] Run `npm run ci`

## Definition of Done

- After message saved, confirmation reply sent to user
- Reply is threaded (references original message)
- Reply failure doesn't break the flow
- Tests cover success and failure paths
- `npm run ci` passes

## Verification Commands

===
npm run ci
npm run test:coverage
===

## Rollback Plan

Git revert. No database changes.
