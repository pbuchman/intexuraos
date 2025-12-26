# 1-0 Firestore Message Storage

**Tier:** 1 (Independent)  
**Status:** Pending  
**Depends on:** 0-0 (Notion removal complete)

## Context Snapshot

After removing Notion integration, WhatsApp messages need a new storage destination. Messages should be stored in Firestore, organized by user identifier for easy retrieval.

Current webhook event storage (`whatsapp_webhook_events` collection) stores:

- Full payload
- Processing status
- Metadata

New requirement: store actual message content in a user-centric way.

## Problem Statement

Need to persist WhatsApp messages in Firestore so they can be:

1. Retrieved by user identifier
2. Displayed in the web app
3. Deleted by the user
4. Analyzed later

## Scope

**In scope:**

- New domain model: `WhatsAppMessage`
- New Firestore collection: `whatsapp_messages`
- Repository port and adapter
- Store all available info from webhook payload
- Query by userId, ordered by timestamp

**Out of scope:**

- Web API endpoints (task 2-0)
- Web UI (task 2-1)
- Delete functionality (task 2-2)

## Required Approach

### Domain Model

===
interface WhatsAppMessage {
id: string; // Firestore document ID
userId: string; // IntexuraOS user ID
waMessageId: string; // WhatsApp message ID (wamid.xxx)
fromNumber: string; // Sender phone number
toNumber: string; // Receiving business number
text: string; // Message text content
timestamp: string; // ISO timestamp from WhatsApp
receivedAt: string; // When webhook received it
webhookEventId: string; // Reference to webhook_events doc
metadata?: { // Additional info from payload
senderName?: string; // Profile name if available
displayPhoneNumber?: string; // Business number display format
};
}
===

### Firestore Collection

Collection: `whatsapp_messages`

- Document ID: auto-generated UUID
- Indexed on: `userId` + `receivedAt` (descending) for efficient queries

### Repository Interface

===
interface WhatsAppMessageRepository {
saveMessage(message: Omit<WhatsAppMessage, 'id'>): Promise<Result<WhatsAppMessage, InboxError>>;
getMessagesByUser(userId: string, limit?: number): Promise<Result<WhatsAppMessage[], InboxError>>;
getMessage(messageId: string): Promise<Result<WhatsAppMessage | null, InboxError>>;
deleteMessage(messageId: string): Promise<Result<void, InboxError>>;
}
===

## Step Checklist

- [ ] Create `apps/whatsapp-service/src/domain/inbox/models/WhatsAppMessage.ts`
- [ ] Export from domain index
- [ ] Create port interface in `repositories.ts`
- [ ] Create `apps/whatsapp-service/src/infra/firestore/messageRepository.ts`
- [ ] Add adapter class in `adapters.ts`
- [ ] Add to `ServiceContainer` in `services.ts`
- [ ] Update webhook processing to save message after extracting from payload
- [ ] Write unit tests for repository
- [ ] Write integration tests for message flow
- [ ] Run `npx prettier --write .`
- [ ] Run `npm run ci`

## Definition of Done

- `WhatsAppMessage` model defined in domain
- `WhatsAppMessageRepository` port defined
- Firestore adapter implemented
- Webhook saves messages to Firestore
- Messages queryable by userId
- Tests cover happy path and error cases
- `npm run ci` passes

## Verification Commands

===
npm run ci
npm run test:coverage
===

## Rollback Plan

1. Remove new files
2. Revert service container changes
3. Git revert commit

No data loss — new collection, old data unaffected.
