# 1-1: Change Action Type Use Case

## Objective

Create use case that changes action type and logs the transition.

## Tasks

### 1. Create use case

File: `apps/actions-agent/src/domain/usecases/changeActionType.ts`

```typescript
import type { Logger } from '@intexuraos/common-core';
import type { Result } from '@intexuraos/common-core';
import type { ActionRepository } from '../ports/actionRepository.js';
import type { ActionTransitionRepository } from '../ports/actionTransitionRepository.js';
import type { CommandsRouterClient } from '../../infra/http/commandsRouterClient.js';
import type { ActionType } from '../models/action.js';
import { createActionTransition } from '../models/actionTransition.js';

export interface ChangeActionTypeParams {
  actionId: string;
  userId: string;
  newType: ActionType;
}

export interface ChangeActionTypeDeps {
  actionRepository: ActionRepository;
  actionTransitionRepository: ActionTransitionRepository;
  commandsRouterClient: CommandsRouterClient;
  logger: Logger;
}

export type ChangeActionTypeUseCase = (
  params: ChangeActionTypeParams
) => Promise<Result<{ actionId: string }, { code: string; message: string }>>;

export function makeChangeActionTypeUseCase(deps: ChangeActionTypeDeps): ChangeActionTypeUseCase {
  return async (params) => {
    const { actionId, userId, newType } = params;
    const { actionRepository, actionTransitionRepository, commandsRouterClient, logger } = deps;

    // 1. Fetch action
    const action = await actionRepository.getById(actionId);
    if (action === null || action.userId !== userId) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Action not found' } };
    }

    // 2. Validate status allows type change
    const allowedStatuses = ['pending', 'awaiting_approval'];
    if (!allowedStatuses.includes(action.status)) {
      return {
        ok: false,
        error: {
          code: 'INVALID_STATUS',
          message: `Cannot change type for action in status: ${action.status}`,
        },
      };
    }

    // 3. Skip if same type
    if (action.type === newType) {
      return { ok: true, value: { actionId } };
    }

    // 4. Fetch command text from commands-router (never trust frontend)
    const command = await commandsRouterClient.getCommand(action.commandId);
    if (command === null) {
      return { ok: false, error: { code: 'COMMAND_NOT_FOUND', message: 'Command not found' } };
    }

    // 5. Log transition
    const transition = createActionTransition({
      userId,
      actionId,
      commandId: action.commandId,
      commandText: command.text,
      originalType: action.type,
      newType,
      originalConfidence: action.confidence,
    });
    await actionTransitionRepository.save(transition);

    logger.info('Action type changed', {
      actionId,
      originalType: action.type,
      newType,
      transitionId: transition.id,
    });

    // 6. Update action type
    action.type = newType;
    action.updatedAt = new Date().toISOString();
    await actionRepository.update(action);

    return { ok: true, value: { actionId } };
  };
}
```

### 2. Register in services.ts

Add factory function and expose via `getServices()`.

### 3. Export from domain/usecases/index.ts

## Verification

- [ ] Use case validates status
- [ ] Use case logs transition before updating action
- [ ] Use case skips if type unchanged
- [ ] Registered in services container

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
