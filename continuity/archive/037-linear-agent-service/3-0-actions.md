# Task 3-0: Update Actions-Agent with Linear Handler

## Tier

3 (Integration)

## Context

Linear-agent service is complete. Now integrate it with actions-agent so linear actions are routed correctly.

## Problem Statement

Need to:

1. Add 'linear' to ActionType enum
2. Create handleLinearAction use case
3. Create executeLinearAction use case
4. Register linear handler in registry
5. Update routes to accept linear type
6. Add linear-agent HTTP client

## Scope

### In Scope

- Add linear type to actions-agent
- Create linear action handler (follows calendar pattern)
- Register in handler registry
- Update schemas to include linear type

### Out of Scope

- Commands-agent classification update (next task)
- Web app updates (tier 4)

## Required Approach

1. **Study** `apps/actions-agent/src/domain/usecases/handleCalendarAction.ts`
2. **Study** `apps/actions-agent/src/domain/usecases/executeCalendarAction.ts`
3. **Add** linear type to models
4. **Create** linear handler following same pattern
5. **Register** in handler registry
6. **Update** tests

## Step Checklist

- [ ] Update `apps/actions-agent/src/domain/models/action.ts` - Add 'linear' to ActionType
- [ ] Create `apps/actions-agent/src/domain/ports/linearAgentClient.ts`
- [ ] Create `apps/actions-agent/src/infra/http/linearAgentHttpClient.ts`
- [ ] Create `apps/actions-agent/src/domain/usecases/executeLinearAction.ts`
- [ ] Create `apps/actions-agent/src/domain/usecases/handleLinearAction.ts`
- [ ] Update `apps/actions-agent/src/domain/usecases/actionHandlerRegistry.ts`
- [ ] Update `apps/actions-agent/src/services.ts` - Add linear handler
- [ ] Update route schemas to include 'linear' type
- [ ] Update tests
- [ ] Run workspace verification

## Definition of Done

- Linear actions routed to linear-agent
- All tests pass
- Workspace verification passes

## Verification Commands

```bash
cd apps/actions-agent
pnpm run typecheck
pnpm vitest run
cd ../..

pnpm run verify:workspace:tracked -- actions-agent
```

## Rollback Plan

```bash
git checkout apps/actions-agent/
```

## Reference Files

- `apps/actions-agent/src/domain/models/action.ts`
- `apps/actions-agent/src/domain/usecases/handleCalendarAction.ts`
- `apps/actions-agent/src/domain/usecases/executeCalendarAction.ts`
- `apps/actions-agent/src/domain/usecases/actionHandlerRegistry.ts`

## Changes to domain/models/action.ts

```typescript
// Update ActionType to include 'linear'
export type ActionType = 'todo' | 'research' | 'note' | 'link' | 'calendar' | 'reminder' | 'linear';
```

## domain/ports/linearAgentClient.ts

```typescript
/**
 * Port for Linear Agent service communication.
 */

import type { Result } from '@intexuraos/common-core';

export interface ProcessLinearActionResponse {
  status: 'completed' | 'failed';
  resourceUrl?: string;
  issueIdentifier?: string;
  error?: string;
}

export interface LinearAgentClient {
  processAction(
    actionId: string,
    userId: string,
    title: string
  ): Promise<Result<ProcessLinearActionResponse, Error>>;
}
```

## infra/http/linearAgentHttpClient.ts

```typescript
/**
 * HTTP client for Linear Agent service.
 */

import { ok, err, type Result, getErrorMessage } from '@intexuraos/common-core';
import type {
  LinearAgentClient,
  ProcessLinearActionResponse,
} from '../../domain/ports/linearAgentClient.js';
import pino from 'pino';

const logger = pino({ name: 'linear-agent-client' });

export interface LinearAgentHttpClientConfig {
  baseUrl: string;
  internalAuthToken: string;
}

export function createLinearAgentHttpClient(
  config: LinearAgentHttpClientConfig
): LinearAgentClient {
  return {
    async processAction(
      actionId: string,
      userId: string,
      title: string
    ): Promise<Result<ProcessLinearActionResponse, Error>> {
      try {
        logger.info({ actionId, userId }, 'Calling linear-agent processAction');

        const response = await fetch(`${config.baseUrl}/internal/linear/process-action`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Auth': config.internalAuthToken,
          },
          body: JSON.stringify({
            action: { id: actionId, userId, title },
          }),
        });

        if (!response.ok) {
          const text = await response.text();
          logger.error(
            { actionId, status: response.status, body: text },
            'Linear agent returned error'
          );
          return err(new Error(`Linear agent error: ${response.status} ${text}`));
        }

        const data = (await response.json()) as ProcessLinearActionResponse;
        logger.info({ actionId, status: data.status }, 'Linear agent response received');

        return ok(data);
      } catch (error) {
        logger.error({ actionId, error: getErrorMessage(error) }, 'Failed to call linear-agent');
        return err(new Error(getErrorMessage(error)));
      }
    },
  };
}
```

## domain/usecases/executeLinearAction.ts

Follow pattern from `executeCalendarAction.ts`:

- Call linearAgentClient.processAction
- Update action status to completed/failed
- Return result

## domain/usecases/handleLinearAction.ts

Follow pattern from `handleCalendarAction.ts`:

- Check if action exists and is pending
- Optionally auto-execute (if shouldAutoExecute returns true)
- Otherwise set to awaiting_approval
- Send WhatsApp notification

## Update actionHandlerRegistry.ts

```typescript
import type { HandleLinearActionUseCase } from './handleLinearAction.js';

export interface ActionHandlerRegistry {
  research: HandleResearchActionUseCase;
  todo: HandleTodoActionUseCase;
  note: HandleNoteActionUseCase;
  link: HandleLinkActionUseCase;
  calendar: HandleCalendarActionUseCase;
  linear: HandleLinearActionUseCase; // Add this
}
```

## Update services.ts

Add linear handler initialization following calendar handler pattern.

## Update route schemas

In `publicRoutes.ts` and `internalRoutes.ts`, update ActionType enums:

```typescript
enum: ['todo', 'research', 'note', 'link', 'calendar', 'reminder', 'linear']
```

## Update environment variables

Add `INTEXURAOS_LINEAR_AGENT_URL` to:

- `apps/actions-agent/src/index.ts` REQUIRED_ENV
- `apps/actions-agent/src/config.ts`

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
