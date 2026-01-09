# 2-1 End-to-End Integration Testing

**Tier:** 2 (Dependent/Integrative)

## Context

All code and Terraform are complete. Before deploying, we need to verify the integration locally.

## Problem Statement

We need to validate:

1. OAuth flow works end-to-end
2. Token storage and retrieval works
3. Calendar operations work with valid tokens
4. Action approval flow works
5. Token refresh works when expired

## Scope

**In scope:**

- Local integration testing with emulators
- OAuth flow simulation
- Calendar operation testing
- Action flow testing
- Token refresh testing

**Not in scope:**

- Production deployment (next task)
- Load testing
- UI testing (manual)

## Required Approach

1. Start local development environment
2. Test OAuth initiate → callback → status flow
3. Test calendar CRUD operations
4. Test action → approval → event creation flow
5. Test token refresh (simulate expired token)

## Step Checklist

### Environment Setup

- [ ] Start Firestore emulator
- [ ] Start PubSub emulator
- [ ] Start all services via `npm run dev`

### OAuth Flow Testing

- [ ] Test POST /oauth/connections/google/initiate returns redirect URL
- [ ] Test GET /oauth/connections/google/callback stores tokens
- [ ] Test GET /oauth/connections/google/status returns connected status
- [ ] Test DELETE /oauth/connections/google removes connection
- [ ] Test GET /internal/users/:uid/oauth/google/token returns valid token

### Calendar Operations Testing

- [ ] Test GET /calendar/events lists events
- [ ] Test POST /calendar/events creates event
- [ ] Test GET /calendar/events/:id gets event
- [ ] Test PATCH /calendar/events/:id updates event
- [ ] Test DELETE /calendar/events/:id deletes event
- [ ] Test POST /calendar/freebusy returns free/busy slots

### Action Flow Testing

- [ ] Create calendar action via PubSub
- [ ] Verify action transitions to `awaiting_approval`
- [ ] Simulate approval
- [ ] Verify calendar event created
- [ ] Verify action transitions to `completed`

### Token Refresh Testing

- [ ] Store token with short expiry
- [ ] Request token after expiry
- [ ] Verify refresh happens automatically
- [ ] Verify new access token returned

### Verification

- [ ] All tests pass locally
- [ ] No errors in service logs

## Definition of Done

- [ ] OAuth flow works: initiate → callback → status → disconnect
- [ ] Calendar CRUD operations work
- [ ] Action approval flow creates calendar event
- [ ] Token refresh works automatically
- [ ] All services healthy during tests

## Verification Commands

```bash
npm run dev
# In separate terminal, run integration tests or manual curl commands
curl -X GET http://localhost:8100/health  # user-service
curl -X GET http://localhost:8116/health  # calendar-agent
curl -X GET http://localhost:8106/health  # actions-agent
```

## Rollback Plan

No rollback needed - this is testing only.

## Test Scripts

Create test scripts if needed:

```bash
# test-oauth-flow.sh
curl -X POST http://localhost:8100/oauth/connections/google/initiate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"

# test-calendar-create.sh
curl -X POST http://localhost:8116/calendar/events \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"summary":"Test Event","start":"2024-01-15T10:00:00Z","end":"2024-01-15T11:00:00Z"}'
```

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
