import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { requireAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import type { ActionStatus, ActionType } from '../domain/models/action.js';

const actionSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    userId: { type: 'string' },
    commandId: { type: 'string' },
    type: { type: 'string', enum: ['todo', 'research', 'note', 'link', 'calendar', 'reminder'] },
    confidence: { type: 'number' },
    title: { type: 'string' },
    status: {
      type: 'string',
      enum: [
        'pending',
        'awaiting_approval',
        'processing',
        'completed',
        'failed',
        'rejected',
        'archived',
      ],
    },
    payload: { type: 'object' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
  required: [
    'id',
    'userId',
    'commandId',
    'type',
    'confidence',
    'title',
    'status',
    'payload',
    'createdAt',
    'updatedAt',
  ],
} as const;

const validStatuses: ActionStatus[] = [
  'pending',
  'awaiting_approval',
  'processing',
  'completed',
  'failed',
  'rejected',
  'archived',
];

export const publicRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.get(
    '/actions',
    {
      schema: {
        operationId: 'listActions',
        summary: 'List actions',
        description:
          'List actions for the authenticated user. Use status param to filter by status (comma-separated).',
        tags: ['actions'],
        querystring: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              description:
                'Comma-separated list of statuses to filter by (e.g., pending,awaiting_approval)',
            },
          },
        },
        response: {
          200: {
            description: 'List of actions',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  actions: {
                    type: 'array',
                    items: actionSchema,
                  },
                },
                required: ['actions'],
              },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'data'],
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { status } = request.query as { status?: string };
      const { actionRepository } = getServices();

      let statusFilter: ActionStatus[] | undefined;
      if (status !== undefined) {
        statusFilter = status
          .split(',')
          .map((s) => s.trim())
          .filter((s): s is ActionStatus => validStatuses.includes(s as ActionStatus));
      }

      const actions = await actionRepository.listByUserId(user.userId, { status: statusFilter });

      return await reply.ok({ actions });
    }
  );

  fastify.patch(
    '/actions/:actionId',
    {
      schema: {
        operationId: 'updateAction',
        summary: 'Update action',
        description:
          'Update action status (proceed to processing, reject, or archive) and/or type (for pending/awaiting_approval actions).',
        tags: ['actions'],
        params: {
          type: 'object',
          properties: {
            actionId: { type: 'string' },
          },
          required: ['actionId'],
        },
        body: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['processing', 'rejected', 'archived'] },
            type: {
              type: 'string',
              enum: ['todo', 'research', 'note', 'link', 'calendar', 'reminder'],
              description: 'New action type (only for pending/awaiting_approval actions)',
            },
          },
          anyOf: [{ required: ['status'] }, { required: ['type'] }],
        },
        response: {
          200: {
            description: 'Action updated',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  action: actionSchema,
                },
                required: ['action'],
              },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'data'],
          },
          400: {
            description: 'Bad request',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          404: {
            description: 'Action not found',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

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

      // Handle type change first (logs transition before modifying action)
      if (newType !== undefined && newType !== action.type) {
        const result = await changeActionTypeUseCase({
          actionId,
          userId: user.userId,
          newType,
        });
        if (!result.ok) {
          return await reply.fail(result.error.code, result.error.message);
        }
        // Refresh action.type after use case updated it
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
  );

  fastify.delete(
    '/actions/:actionId',
    {
      schema: {
        operationId: 'deleteAction',
        summary: 'Delete action',
        description: 'Delete an action.',
        tags: ['actions'],
        params: {
          type: 'object',
          properties: {
            actionId: { type: 'string' },
          },
          required: ['actionId'],
        },
        response: {
          200: {
            description: 'Action deleted',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success'],
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          404: {
            description: 'Action not found',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { actionId } = request.params as { actionId: string };

      const { actionRepository } = getServices();
      const action = await actionRepository.getById(actionId);

      if (action?.userId !== user.userId) {
        return await reply.fail('NOT_FOUND', 'Action not found');
      }

      await actionRepository.delete(actionId);

      return await reply.ok({});
    }
  );

  // 💰 CostGuard: Batch endpoint prevents N+1 API calls
  // Fetches up to 50 actions in single request instead of 50 individual requests
  fastify.post(
    '/actions/batch',
    {
      schema: {
        operationId: 'batchGetActions',
        summary: 'Batch fetch actions by IDs',
        description:
          'Fetch multiple actions by their IDs in a single request. ' +
          'Maximum 50 action IDs per request.',
        tags: ['actions'],
        body: {
          type: 'object',
          properties: {
            actionIds: {
              type: 'array',
              items: { type: 'string' },
              minItems: 1,
              maxItems: 50, // 💰 CostGuard: Limit to 50 to prevent abuse
              description: 'Array of action IDs to fetch',
            },
          },
          required: ['actionIds'],
        },
        response: {
          200: {
            description: 'Actions fetched successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  actions: {
                    type: 'array',
                    items: actionSchema,
                  },
                },
                required: ['actions'],
              },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'data'],
          },
          400: {
            description: 'Bad request - invalid action IDs',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { actionIds } = request.body as { actionIds: string[] };
      const { actionRepository } = getServices();

      // 💰 CostGuard: Parallel fetches, but limited to 50 IDs max (enforced by schema)
      const actionPromises = actionIds.map(async (id) => {
        return await actionRepository.getById(id);
      });

      const results = await Promise.all(actionPromises);

      // Filter to user's actions only (security)
      const actions = results.filter(
        (action): action is NonNullable<typeof action> =>
          action !== null && action.userId === user.userId
      );

      return await reply.ok({ actions });
    }
  );

  fastify.post(
    '/actions/:actionId/execute',
    {
      schema: {
        operationId: 'executeAction',
        summary: 'Execute action',
        description:
          'Execute an action (e.g., create research draft). Synchronous - waits for completion.',
        tags: ['actions'],
        params: {
          type: 'object',
          properties: {
            actionId: { type: 'string' },
          },
          required: ['actionId'],
        },
        response: {
          200: {
            description: 'Action executed successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  actionId: { type: 'string' },
                  status: { type: 'string', enum: ['completed', 'failed'] },
                  resource_url: { type: 'string' },
                  error: { type: 'string' },
                },
                required: ['actionId', 'status'],
              },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'data'],
          },
          400: {
            description: 'Bad Request',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          403: {
            description: 'Forbidden',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { actionId: string } }>, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { actionId } = request.params;

      const services = getServices();
      const action = await services.actionRepository.getById(actionId);

      if (action?.userId !== user.userId) {
        return await reply.fail('NOT_FOUND', 'Action not found');
      }

      const executorMap: Partial<
        Record<
          ActionType,
          (actionId: string) => ReturnType<typeof services.executeResearchActionUseCase>
        >
      > = {
        research: services.executeResearchActionUseCase,
        todo: services.executeTodoActionUseCase,
        note: services.executeNoteActionUseCase,
        link: services.executeLinkActionUseCase,
      };

      const executor = executorMap[action.type];
      if (executor === undefined) {
        return await reply.fail('INVALID_REQUEST', `Action type ${action.type} not supported`);
      }

      const result = await executor(actionId);

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok({
        actionId,
        ...result.value,
      });
    }
  );

  done();
};
