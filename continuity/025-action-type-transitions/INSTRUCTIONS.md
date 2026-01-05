# Action Type Transitions

## Goal

Allow users to change action type before dispatching to agents, while logging transitions for future ML/few-shot learning improvements.

## Context

Commands are automatically classified by LLM (Gemini) into action types: `todo`, `research`, `note`, `link`, `calendar`, `reminder`. This automation is non-negotiable. However, classification isn't always perfect.

Users should be able to correct the action type **before** the action is dispatched to domain-specific agents. When they do, we log the transition to build training data for future classification improvements.

## Requirements

### Functional

1. **Type change allowed only for**: `pending` and `awaiting_approval` statuses
2. **Changing type does NOT reset status** — action stays in current status
3. **All transitions logged** to `actions_transitions` collection
4. **UI**: Dropdown selector in `ActionDetailModal` to change type

### Data Model

New collection: `actions_transitions` (owned by `actions-agent`)

```typescript
interface ActionTransition {
  id: string;
  userId: string;
  actionId: string;
  commandId: string;
  commandText: string; // For future few-shot learning
  originalType: ActionType;
  newType: ActionType;
  originalConfidence: number;
  createdAt: string;
}
```

### Future-Ready

Architecture should support future "split action" feature where one command becomes multiple actions (e.g., "buy milk and research best brands" → todo + research). Not implementing now, but data model and naming should accommodate.

## Scope

### In Scope

- PATCH endpoint extension to accept `type` field
- `ChangeActionTypeUseCase` with transition logging
- `ActionTransitionRepository` for Firestore
- Web UI dropdown in `ActionDetailModal`
- Tests for all new code

### Out of Scope

- Splitting actions (future feature)
- Using transitions for classification improvement (future feature)
- Changing type after dispatch (`processing`, `completed`, etc.)

## Success Criteria

1. User can change action type via dropdown in modal
2. Type change persists and action dispatches to correct agent
3. Transition logged with all required fields
4. Only `pending`/`awaiting_approval` actions allow type change
5. All tests pass, 95% coverage maintained
6. `npm run ci` passes

## Endpoint Changes

| Service         | Method | Path                                   | Change                    |
| --------------- | ------ | -------------------------------------- | ------------------------- |
| actions-agent   | PATCH  | `/router/actions/:actionId`            | Add optional `type` field |
| commands-router | GET    | `/internal/router/commands/:commandId` | New internal endpoint     |

## Key Files

### Backend (actions-agent)

- `src/domain/models/actionTransition.ts` — new model
- `src/domain/usecases/changeActionType.ts` — new use case
- `src/infra/firestore/actionTransitionRepository.ts` — new repository
- `src/infra/http/commandsRouterClient.ts` — new HTTP client
- `src/routes/publicRoutes.ts` — extend PATCH endpoint
- `src/services.ts` — register new dependencies

### Backend (commands-router)

- `src/routes/internalRoutes.ts` — add GET endpoint for command lookup

### Frontend (web)

- `src/components/ActionDetailModal.tsx` — add type dropdown
- `src/services/actionsApi.ts` — update PATCH call signature

### Config

- `firestore-collections.json` — register `actions_transitions`
