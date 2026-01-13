# Task 1-0: Create Service-to-Service Integration Tests

## Status: NOT STARTED

## Objective

Create comprehensive integration tests for HTTP communication between actions-agent and other services (bookmarks-agent, notes-agent, todos-agent).

## Current State

### Existing Unit Tests (with mocks)

```
apps/actions-agent/src/__tests__/infra/http/
├── bookmarksServiceHttpClient.test.ts  (uses nock mocks)
├── notesServiceHttpClient.test.ts      (uses nock mocks)
└── todosServiceHttpClient.test.ts      (uses nock mocks)
```

These tests mock HTTP responses - they don't verify actual service communication.

### Good Example: whatsapp-service

**File:** `apps/whatsapp-service/src/__tests__/webhookAsyncProcessing.test.ts`

This test demonstrates the correct pattern:

- Real Fastify server instances
- Actual HTTP calls
- Pub/Sub message simulation
- End-to-end verification

## Implementation

### Create Integration Test File

**Path:** `apps/actions-agent/src/__tests__/integration/serviceClients.integration.test.ts`

### Test Scenarios

1. **Authentication Flow**
   - Valid internal auth token accepted
   - Invalid/missing token rejected with 401
   - Token format validated correctly

2. **Request/Response Schemas**
   - Actions-agent sends correct payload format
   - Target service responds with expected format
   - Error responses handled correctly

3. **Network Error Handling**
   - Timeout behavior (connection timeout, read timeout)
   - Service unavailable (503)
   - Network errors propagated correctly

4. **End-to-End Flows**
   - Create bookmark via actions-agent → bookmarks-agent
   - Create note via actions-agent → notes-agent
   - Create todo via actions-agent → todos-agent

## Test Pattern

```typescript
describe('Service Integration Tests', () => {
  let actionsAgentApp: FastifyInstance;
  let bookmarksAgentApp: FastifyInstance;

  beforeAll(async () => {
    // Start real service instances
    bookmarksAgentApp = await buildBookmarksAgent();
    await bookmarksAgentApp.listen({ port: 0 });

    // Configure actions-agent to use test bookmarks URL
    actionsAgentApp = await buildActionsAgent({
      bookmarksAgentUrl: `http://localhost:${bookmarksAgentApp.server.address().port}`,
    });
  });

  afterAll(async () => {
    await actionsAgentApp.close();
    await bookmarksAgentApp.close();
  });

  it('creates bookmark via internal endpoint', async () => {
    const response = await actionsAgentApp.inject({
      method: 'POST',
      url: '/internal/execute-link-action',
      headers: { 'x-internal-auth': validToken },
      payload: {
        /* action payload */
      },
    });

    expect(response.statusCode).toBe(200);
    // Verify bookmark was created in bookmarks-agent
  });
});
```

## Acceptance Criteria

- [ ] Integration tests created for all HTTP clients
- [ ] Auth token validation tested end-to-end
- [ ] Error scenarios covered (401, 503, timeout)
- [ ] Schema compatibility verified
- [ ] Tests pass in CI (`pnpm run ci`)

## Dependencies

- Task 0-0 completed (PR review fixes applied)
