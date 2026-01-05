# 1-3: Commands Router Internal Endpoint

## Objective

Create internal endpoint in commands-router for actions-agent to fetch command details.

## Context

Actions-agent needs to fetch command text when logging type transitions. This is internal service-to-service communication — frontend never provides this data.

## Tasks

### 1. Add internal GET endpoint

File: `apps/commands-router/src/routes/internalRoutes.ts`

```typescript
fastify.get(
  '/internal/router/commands/:commandId',
  {
    schema: {
      operationId: 'getCommandInternal',
      summary: 'Get command by ID (internal)',
      description: 'Internal endpoint for service-to-service command lookup.',
      tags: ['internal'],
      params: {
        type: 'object',
        properties: {
          commandId: { type: 'string' },
        },
        required: ['commandId'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean', enum: [true] },
            data: {
              type: 'object',
              properties: {
                command: { $ref: 'Command#' },
              },
              required: ['command'],
            },
          },
          required: ['success', 'data'],
        },
        404: { ... },
      },
    },
  },
  async (request, reply) => {
    const authResult = validateInternalAuth(request);
    if (!authResult.ok) {
      return await reply.fail('UNAUTHORIZED', authResult.error.message);
    }

    const { commandId } = request.params as { commandId: string };
    const { commandRepository } = getServices();

    const command = await commandRepository.getById(commandId);
    if (command === null) {
      return await reply.fail('NOT_FOUND', 'Command not found');
    }

    return await reply.ok({ command });
  }
);
```

### 2. Create HTTP client in actions-agent

File: `apps/actions-agent/src/infra/http/commandsRouterClient.ts`

```typescript
import { makeInternalHttpClient } from '@intexuraos/common-http';
import type { Command } from '../../domain/models/command.js';

export interface CommandsRouterClient {
  getCommand(commandId: string): Promise<Command | null>;
}

export function makeCommandsRouterClient(baseUrl: string, authToken: string): CommandsRouterClient {
  const client = makeInternalHttpClient(baseUrl, authToken);

  return {
    async getCommand(commandId: string): Promise<Command | null> {
      try {
        const response = await client.get(`/internal/router/commands/${commandId}`);
        return response.data.data.command;
      } catch (error) {
        if (error.response?.status === 404) {
          return null;
        }
        throw error;
      }
    },
  };
}
```

### 3. Register client in actions-agent services.ts

```typescript
const commandsRouterClient = makeCommandsRouterClient(
  config.commandsRouterUrl,
  config.internalAuthToken
);
```

### 4. Add env vars to actions-agent

- `INTEXURAOS_COMMANDS_ROUTER_URL` — commands-router service URL

### 5. Update Terraform if needed

Ensure actions-agent has the commands-router URL in its environment.

## Verification

- [ ] Internal endpoint returns command with text
- [ ] Endpoint validates `X-Internal-Auth` header
- [ ] HTTP client handles 404 gracefully
- [ ] Client registered in services container
- [ ] Env var documented and configured
