# 1-0: Domain Model & Repository

## Objective

Create the `ActionTransition` domain model and Firestore repository.

## Tasks

### 1. Create domain model

File: `apps/actions-agent/src/domain/models/actionTransition.ts`

```typescript
import type { ActionType } from './action.js';

export interface ActionTransition {
  id: string;
  userId: string;
  actionId: string;
  commandId: string;
  commandText: string;
  originalType: ActionType;
  newType: ActionType;
  originalConfidence: number;
  createdAt: string;
}

export function createActionTransition(params: {
  userId: string;
  actionId: string;
  commandId: string;
  commandText: string;
  originalType: ActionType;
  newType: ActionType;
  originalConfidence: number;
}): ActionTransition {
  return {
    id: crypto.randomUUID(),
    ...params,
    createdAt: new Date().toISOString(),
  };
}
```

### 2. Create port interface

File: `apps/actions-agent/src/domain/ports/actionTransitionRepository.ts`

```typescript
import type { ActionTransition } from '../models/actionTransition.js';

export interface ActionTransitionRepository {
  save(transition: ActionTransition): Promise<void>;
  listByUserId(userId: string): Promise<ActionTransition[]>;
}
```

### 3. Create Firestore adapter

File: `apps/actions-agent/src/infra/firestore/actionTransitionRepository.ts`

- Collection: `actions_transitions`
- Implement `save` and `listByUserId`
- Follow existing repository patterns in this service

### 4. Register in firestore-collections.json

Add entry:

```json
{
  "collection": "actions_transitions",
  "owner": "actions-agent",
  "description": "Logs of user corrections to action types for ML training"
}
```

### 5. Export from domain/models/index.ts and domain/ports/index.ts

## Verification

- [ ] Model file exists with correct types
- [ ] Port interface defined
- [ ] Firestore adapter implements port
- [ ] Collection registered in firestore-collections.json
- [ ] `npm run verify:firestore` passes
