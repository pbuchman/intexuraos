# 1-3 Routes and UseCase

## Tier

1 (Independent)

## Context

Implement HTTP routes and ProcessCommandUseCase orchestration.

## Problem

Need endpoints for PubSub push and UI data retrieval.

## Scope

- POST /internal/router/commands - PubSub push handler
- GET /router/commands - List commands (authenticated)
- GET /actions - List actions (authenticated)
- ProcessCommandUseCase - orchestrate flow

## Non-Scope

- Pagination
- Filtering

## Approach

1. Create ProcessCommandUseCase in `domain/usecases/`
2. Create internal routes for PubSub
3. Create router routes for UI
4. Wire up in index.ts

## ProcessCommandUseCase Flow

1. Check if command exists (idempotency)
2. If exists, return success (already processed)
3. Save command with status='received'
4. Call classifier
5. Create action as 'pending'
6. Update command with classification + actionId
7. Return success

## PubSub Message Format

```typescript
interface PubSubMessage {
  message: {
    data: string; // base64 encoded JSON
    messageId: string;
  };
  subscription: string;
}
```

## Routes

- `POST /internal/router/commands` - X-Internal-Auth validated
- `GET /router/commands` - JWT auth, returns user's commands
- `GET /actions` - JWT auth, returns user's actions

## Files

- `domain/usecases/processCommand.ts`
- `routes/internalRoutes.ts`
- `routes/routerRoutes.ts`
- `routes/index.ts`

## Checklist

- [ ] ProcessCommandUseCase with full flow
- [ ] Internal route with auth validation
- [ ] Router routes with JWT auth
- [ ] OpenAPI schemas
- [ ] Wire up in services.ts

## Definition of Done

All routes respond correctly, use case orchestrates the flow.

## Verification

```bash
npm run typecheck --workspace=@intexuraos/commands-router
npm run dev --workspace=@intexuraos/commands-router &
curl http://localhost:8080/openapi.json | jq '.paths'
kill %1
```

## Rollback

Delete route and usecase files.

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
