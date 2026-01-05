# 1-2: Extend PATCH Endpoint

## Objective

Extend `PATCH /router/actions/:actionId` to accept optional `type` field.

## Current State

File: `apps/actions-agent/src/routes/publicRoutes.ts`

Current body schema:

```typescript
body: {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['processing', 'rejected', 'archived'] },
  },
  required: ['status'],
}
```

## Tasks

### 1. Update schema

```typescript
body: {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['processing', 'rejected', 'archived'] },
    type: {
      type: 'string',
      enum: ['todo', 'research', 'note', 'link', 'calendar', 'reminder'],
      description: 'New action type (only for pending/awaiting_approval)',
    },
  },
  // Make status optional since user might only change type
  required: [],
  anyOf: [
    { required: ['status'] },
    { required: ['type'] },
  ],
}
```

### 2. Update handler logic

```typescript
async (request: FastifyRequest, reply: FastifyReply) => {
  const user = await requireAuth(request, reply);
  if (user === null) return;

  const { actionId } = request.params as { actionId: string };
  const { status, type: newType } = request.body as {
    status?: 'processing' | 'rejected' | 'archived';
    type?: ActionType;
  };

  const { actionRepository, changeActionTypeUseCase } = getServices();
  const action = await actionRepository.getById(actionId);

  if (action?.userId !== user.userId) {
    return await reply.fail('NOT_FOUND', 'Action not found');
  }

  // Handle type change first (needs command text for logging)
  if (newType !== undefined && newType !== action.type) {
    // Need to fetch command text for transition log
    // Option 1: Require commandText in request body
    // Option 2: Fetch from commands-router (cross-service call)
    // Decision: Require in body for simplicity
    const result = await changeActionTypeUseCase({
      actionId,
      userId: user.userId,
      newType,
      commandText: /* from body */,
    });
    if (!result.ok) {
      return await reply.fail(result.error.code, result.error.message);
    }
    // Refresh action after type change
    action.type = newType;
  }

  // Handle status change
  if (status !== undefined) {
    action.status = status;
    action.updatedAt = new Date().toISOString();
    await actionRepository.update(action);
  }

  return await reply.ok({ action });
}
```

### 3. Decision: commandText source

**Options:**

1. ~~Require `commandText` in request body when changing type~~
2. **Fetch command from commands-router via internal HTTP call** ✓
3. Store `commandText` on Action model (denormalization)

**Decision:** Option 2 — backend fetches from commands-router. Never trust frontend with audit data.

Flow:

1. User sends `PATCH { type: 'todo' }` (no commandText)
2. Backend fetches command via `GET /internal/router/commands/:commandId`
3. Backend extracts `command.text` for transition log

Requires:

- New internal endpoint in commands-router: `GET /internal/router/commands/:commandId`
- Internal HTTP client in actions-agent to call commands-router

## Verification

- [ ] Schema accepts `type` field
- [ ] Schema allows either `status` or `type` (or both)
- [ ] Handler calls `changeActionTypeUseCase` when type provided
- [ ] Returns 400 if type change attempted on wrong status
- [ ] Returns 400 if type change without commandText

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
