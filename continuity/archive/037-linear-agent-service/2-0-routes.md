# Task 2-0: Implement HTTP Routes

## Tier

2 (Dependent Deliverables)

## Context

Domain layer and use cases are complete. Now implement the HTTP routes for both public (web UI) and internal (service-to-service) endpoints.

## Problem Statement

Need to implement:

1. Public routes for web dashboard and connection management
2. Internal route for action processing (called by actions-agent)

## Scope

### In Scope

- `routes/linearRoutes.ts` - Public endpoints (Bearer auth)
- `routes/internalRoutes.ts` - Internal endpoint (X-Internal-Auth)
- OpenAPI schema definitions
- Error handling and response formatting

### Out of Scope

- Server setup (next task)
- Actual deployment

## Required Approach

1. **Study** `apps/calendar-agent/src/routes/calendarRoutes.ts`
2. **Study** `apps/calendar-agent/src/routes/internalRoutes.ts`
3. **Implement** public routes for connection and issues
4. **Implement** internal route for action processing
5. **Write tests** for all routes

## Step Checklist

- [ ] Create `apps/linear-agent/src/routes/linearRoutes.ts`
- [ ] Implement GET `/linear/connection` - Get connection status
- [ ] Implement POST `/linear/connection` - Save connection (API key + team)
- [ ] Implement DELETE `/linear/connection` - Disconnect
- [ ] Implement POST `/linear/connection/validate` - Validate API key, return teams
- [ ] Implement GET `/linear/issues` - List grouped issues
- [ ] Create `apps/linear-agent/src/routes/internalRoutes.ts`
- [ ] Implement POST `/internal/linear/process-action` - Process action
- [ ] Create route tests
- [ ] Ensure tests pass

## Definition of Done

- All routes implemented with schemas
- Tests cover success and error cases
- TypeScript compiles

## Verification Commands

```bash
cd apps/linear-agent
pnpm run typecheck
pnpm vitest run src/__tests__/routes
cd ../..
```

## Rollback Plan

```bash
rm -rf apps/linear-agent/src/routes/
```

## Reference Files

- `apps/calendar-agent/src/routes/calendarRoutes.ts`
- `apps/calendar-agent/src/routes/internalRoutes.ts`
- `apps/notion-service/src/routes/integrationRoutes.ts`

## routes/linearRoutes.ts

```typescript
/**
 * Public API routes for Linear integration.
 * Handles connection management and issue listing.
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { getServices } from '../services.js';
import { listIssues } from '../domain/index.js';

interface ConnectionBody {
  apiKey: string;
  teamId: string;
  teamName: string;
}

interface ValidateBody {
  apiKey: string;
}

export const linearRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // Get connection status
  fastify.get(
    '/linear/connection',
    {
      schema: {
        operationId: 'getLinearConnection',
        summary: 'Get Linear connection status',
        tags: ['linear'],
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                nullable: true,
                properties: {
                  connected: { type: 'boolean' },
                  teamId: { type: 'string', nullable: true },
                  teamName: { type: 'string', nullable: true },
                  createdAt: { type: 'string' },
                  updatedAt: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId;
      const { connectionRepository } = getServices();

      const result = await connectionRepository.getConnection(userId);
      if (!result.ok) {
        reply.status(500);
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.success(result.value);
    }
  );

  // Validate API key and get teams
  fastify.post<{ Body: ValidateBody }>(
    '/linear/connection/validate',
    {
      schema: {
        operationId: 'validateLinearApiKey',
        summary: 'Validate Linear API key and get available teams',
        tags: ['linear'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['apiKey'],
          properties: {
            apiKey: { type: 'string', description: 'Linear Personal API key' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  teams: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                        key: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: ValidateBody }>, reply: FastifyReply) => {
      const { apiKey } = request.body;
      const { linearApiClient } = getServices();

      const result = await linearApiClient.validateAndGetTeams(apiKey);
      if (!result.ok) {
        if (result.error.code === 'INVALID_API_KEY') {
          reply.status(401);
          return await reply.fail('UNAUTHORIZED', result.error.message);
        }
        reply.status(500);
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.success({ teams: result.value });
    }
  );

  // Save connection
  fastify.post<{ Body: ConnectionBody }>(
    '/linear/connection',
    {
      schema: {
        operationId: 'saveLinearConnection',
        summary: 'Save Linear connection configuration',
        tags: ['linear'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['apiKey', 'teamId', 'teamName'],
          properties: {
            apiKey: { type: 'string' },
            teamId: { type: 'string' },
            teamName: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  connected: { type: 'boolean' },
                  teamId: { type: 'string' },
                  teamName: { type: 'string' },
                  createdAt: { type: 'string' },
                  updatedAt: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: ConnectionBody }>, reply: FastifyReply) => {
      const userId = request.userId;
      const { apiKey, teamId, teamName } = request.body;
      const { connectionRepository } = getServices();

      const result = await connectionRepository.save(userId, apiKey, teamId, teamName);
      if (!result.ok) {
        reply.status(500);
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.success(result.value);
    }
  );

  // Disconnect
  fastify.delete(
    '/linear/connection',
    {
      schema: {
        operationId: 'disconnectLinear',
        summary: 'Disconnect Linear integration',
        tags: ['linear'],
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  connected: { type: 'boolean' },
                },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId;
      const { connectionRepository } = getServices();

      const result = await connectionRepository.disconnect(userId);
      if (!result.ok) {
        reply.status(500);
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.success(result.value);
    }
  );

  // List issues (grouped for dashboard)
  fastify.get<{ Querystring: { includeArchive?: string } }>(
    '/linear/issues',
    {
      schema: {
        operationId: 'listLinearIssues',
        summary: 'List Linear issues grouped by status',
        tags: ['linear'],
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            includeArchive: { type: 'string', enum: ['true', 'false'] },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  teamName: { type: 'string' },
                  issues: {
                    type: 'object',
                    properties: {
                      backlog: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/LinearIssue' },
                      },
                      in_progress: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/LinearIssue' },
                      },
                      in_review: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/LinearIssue' },
                      },
                      done: { type: 'array', items: { $ref: '#/components/schemas/LinearIssue' } },
                      archive: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/LinearIssue' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Querystring: { includeArchive?: string } }>,
      reply: FastifyReply
    ) => {
      const userId = request.userId;
      const includeArchive = request.query.includeArchive !== 'false';
      const services = getServices();

      const result = await listIssues(
        { userId, includeArchive },
        {
          linearApiClient: services.linearApiClient,
          connectionRepository: services.connectionRepository,
          logger: request.log,
        }
      );

      if (!result.ok) {
        if (result.error.code === 'NOT_CONNECTED') {
          reply.status(403);
          return await reply.fail('FORBIDDEN', result.error.message);
        }
        reply.status(500);
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.success(result.value);
    }
  );

  done();
};
```

## routes/internalRoutes.ts

```typescript
/**
 * Internal API routes for service-to-service communication.
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { processLinearAction } from '../domain/index.js';

interface ProcessActionBody {
  action: {
    id: string;
    userId: string;
    title: string;
  };
}

export const internalRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post<{ Body: ProcessActionBody }>(
    '/internal/linear/process-action',
    {
      schema: {
        operationId: 'processLinearAction',
        summary: 'Process a Linear action from natural language',
        description: 'Extracts issue data from text and creates in Linear',
        tags: ['internal'],
        body: {
          type: 'object',
          required: ['action'],
          properties: {
            action: {
              type: 'object',
              required: ['id', 'userId', 'title'],
              properties: {
                id: { type: 'string', description: 'Action ID' },
                userId: { type: 'string', description: 'User ID' },
                title: { type: 'string', description: 'User message text to extract issue from' },
              },
            },
          },
        },
        response: {
          200: {
            description: 'Success',
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['completed', 'failed'] },
              resource_url: { type: 'string', description: 'Linear issue URL' },
              issue_identifier: { type: 'string', description: 'Issue identifier (e.g., ENG-123)' },
              error: { type: 'string', description: 'Error message if failed' },
            },
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: ProcessActionBody }>, reply: FastifyReply) => {
      logIncomingRequest(request);

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        reply.status(401);
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      const services = getServices();
      const { action } = request.body;

      request.log.info(
        { actionId: action.id, userId: action.userId, textLength: action.title.length },
        'internal/processLinearAction: processing action'
      );

      const result = await processLinearAction(
        {
          actionId: action.id,
          userId: action.userId,
          text: action.title,
        },
        {
          linearApiClient: services.linearApiClient,
          connectionRepository: services.connectionRepository,
          failedIssueRepository: services.failedIssueRepository,
          extractionService: services.extractionService,
          logger: request.log,
        }
      );

      if (!result.ok) {
        if (result.error.code === 'NOT_CONNECTED') {
          reply.status(403);
          return await reply.fail('FORBIDDEN', result.error.message);
        }
        reply.status(500);
        return await reply.fail('DOWNSTREAM_ERROR', result.error.message);
      }

      request.log.info(
        { actionId: action.id, status: result.value.status },
        'internal/processLinearAction: complete'
      );

      return await reply.send({
        status: result.value.status,
        resource_url: result.value.resourceUrl,
        issue_identifier: result.value.issueIdentifier,
        error: result.value.error,
      });
    }
  );

  done();
};
```

---

## Continuation

**DO NOT STOP.** After completing this task and committing, immediately proceed to the next task without waiting for user input.
