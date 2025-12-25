# 2-0 WhatsApp Notes API Endpoints

**Tier:** 2 (Dependent)  
**Status:** Pending  
**Depends on:** 1-0 (Message storage)

## Context Snapshot

Messages will be stored in Firestore (`whatsapp_messages` collection). Web app needs API endpoints to:
1. List user's messages
2. Delete a specific message

## Problem Statement

Create REST API endpoints in whatsapp-service for:
- Fetching user's WhatsApp messages (for display in web app)
- Deleting a specific message

## Scope

**In scope:**
- `GET /v1/whatsapp/messages` — list user's messages
- `DELETE /v1/whatsapp/messages/:messageId` — delete specific message
- OpenAPI documentation
- Authentication (require valid JWT)
- Tests

**Out of scope:**
- Web UI (task 2-1)
- Pagination (explicit: no paging for now)

## Required Approach

### GET /v1/whatsapp/messages

===
Request:
  Headers: Authorization: Bearer <token>
  Query params: (none for now, no pagination)

Response 200:
{
  "success": true,
  "data": {
    "messages": [
      {
        "id": "msg-uuid",
        "text": "Message content",
        "fromNumber": "+48123456789",
        "timestamp": "2025-12-25T10:30:00Z",
        "receivedAt": "2025-12-25T10:30:01Z"
      }
    ],
    "fromNumber": "+48123456789"  // User's registered number (for header display)
  }
}

Response 401: Unauthorized
Response 502: Downstream error
===

### DELETE /v1/whatsapp/messages/:messageId

===
Request:
  Headers: Authorization: Bearer <token>
  Path params: messageId

Response 200:
{
  "success": true,
  "data": { "deleted": true }
}

Response 401: Unauthorized
Response 404: Message not found (or not owned by user)
Response 502: Downstream error
===

### Route File

Create `apps/whatsapp-service/src/routes/v1/messageRoutes.ts`

### Security

- Verify JWT token
- Ensure user can only access/delete their own messages
- Check `userId` matches message owner before delete

## Step Checklist

- [ ] Create `messageRoutes.ts` with GET and DELETE endpoints
- [ ] Add OpenAPI schema definitions
- [ ] Implement authentication check
- [ ] Implement list messages handler
- [ ] Implement delete message handler (with ownership check)
- [ ] Register routes in `routes.ts`
- [ ] Write unit tests
- [ ] Write integration tests
- [ ] Update OpenAPI spec
- [ ] Run `npx prettier --write .`
- [ ] Run `npm run ci`

## Definition of Done

- GET endpoint returns user's messages sorted by newest first
- DELETE endpoint removes message (only if owned by user)
- 404 returned if message not found or not owned
- OpenAPI spec updated
- Tests cover all paths
- `npm run ci` passes

## Verification Commands

===
npm run ci
npm run test:coverage
curl -X GET http://localhost:3002/v1/whatsapp/messages -H "Authorization: Bearer <token>"
===

## Rollback Plan

Git revert. No database migrations.

