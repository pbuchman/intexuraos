# 2-0: Create Routes

## Tier

2 (Dependent)

## Context

Create HTTP routes that wire usecases to REST endpoints.

## Problem Statement

Need routes for:

- POST /v1/mobile-notifications/connect (JWT)
- POST /v1/webhooks/mobile-notifications (signature only)
- GET /v1/mobile-notifications (JWT)
- DELETE /v1/mobile-notifications/:id (JWT)

## Scope

- Route definitions with OpenAPI schemas
- Input validation
- Authentication handling
- Integration tests

## Non-Scope

- Business logic (in usecases)
- Firestore details (in adapters)

## Required Approach

Routes must be thin - only:

1. Parse/validate input
2. Extract auth info
3. Call usecase
4. Format response

## Endpoints

### POST /v1/mobile-notifications/connect

- Auth: JWT required
- Body: `{ deviceLabel?: string }`
- Response: `{ connectionId: string, signature: string }`

### POST /v1/webhooks/mobile-notifications

- Auth: Header `X-Mobile-Notifications-Signature`
- Body: notification payload
- Response: `{ status: 'accepted' | 'ignored', id?: string }`
- Always 200 OK

### GET /v1/mobile-notifications

- Auth: JWT required
- Query: `limit`, `cursor`
- Response: `{ notifications: [...], nextCursor?: string }`

### DELETE /v1/mobile-notifications/:id

- Auth: JWT required
- Response: 204 No Content or 404/403

## Step Checklist

- [ ] Create src/routes/v1/connectRoutes.ts
- [ ] Create src/routes/v1/webhookRoutes.ts
- [ ] Create src/routes/v1/notificationRoutes.ts
- [ ] Create src/routes/v1/routes.ts (barrel)
- [ ] Create src/routes/v1/schemas.ts
- [ ] Add OpenAPI decorations
- [ ] Create integration tests
- [ ] Verify tests pass

## Definition of Done

- All routes implemented
- OpenAPI spec generated at /openapi.json
- Swagger UI at /docs
- Integration tests passing
- `npm run ci` passes

## Verification Commands

```bash
npm run ci
curl http://localhost:PORT/openapi.json
```

## Rollback Plan

Delete routes and tests
