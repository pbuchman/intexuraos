# Task 032: Service-to-Service Integration Tests

## Overview

Verify and test HTTP communication patterns between modules. The codebase has grown to include multiple services that communicate via internal HTTP endpoints, but integration tests for these communication patterns are missing.

## Problem Statement

**Current State:**

- Multiple services communicate via HTTP (actions-agent → bookmarks-agent, notes-agent, todos-agent)
- Unit tests exist with mocked HTTP responses using `nock`
- No integration tests verify actual service-to-service communication
- No tests verify internal auth token validation between services
- Schema drift between services goes undetected until production

**Why This Matters:**

- Breaking changes in one service's API won't be caught until production
- Internal auth token format changes can silently break inter-service communication
- Payload schema mismatches accumulate as services evolve independently
- Network failures, timeouts, and error handling aren't tested end-to-end

## Examples

### Missing Integration Tests (from PR #275 review)

**actions-agent HTTP clients:**

- `apps/actions-agent/src/infra/http/bookmarksServiceHttpClient.ts`
- `apps/actions-agent/src/infra/http/notesServiceHttpClient.ts`
- `apps/actions-agent/src/infra/http/todosServiceHttpClient.ts`

These have unit tests with mocked responses:

```typescript
// Current: apps/actions-agent/src/__tests__/infra/http/bookmarksServiceHttpClient.test.ts
nock('https://example.com')
  .post('/internal/bookmarks')
  .reply(200, { success: true, ... });
```

But no integration tests verify:

1. Real HTTP calls with internal auth tokens
2. Server-side auth token validation
3. Payload schema compatibility
4. Error response handling

### Good Example (whatsapp-service)

Reference: `apps/whatsapp-service/src/__tests__/webhookAsyncProcessing.test.ts`

This test demonstrates the correct pattern:

- Real Fastify server instances
- Actual HTTP calls between components
- Pub/Sub message simulation
- End-to-end async processing verification

## Scope

### In Scope

1. Integration tests for actions-agent → bookmarks/notes/todos communication
2. Internal auth token validation tests
3. Error handling and timeout tests
4. Schema validation between services

### Out of Scope

- Changing existing HTTP client implementations
- Adding new service communication patterns
- Performance or load testing

## Success Criteria

1. Integration tests exist for all HTTP clients in actions-agent
2. Tests verify internal auth header handling
3. Tests cover network error scenarios
4. Tests validate request/response schema compatibility
5. All tests pass in CI (`npm run ci`)

## Additional Context

This task also addresses other PR #275 review findings:

- Silent error handling in `.github/scripts/smart-dispatch.mjs`
- Hard-coded retry threshold in `retryPendingActions.ts`
- Missing test coverage for `shouldAutoExecute.ts`
- Inconsistent null safety patterns across services
