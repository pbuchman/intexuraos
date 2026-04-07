import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { createScheduleManager } from '../domain/use-cases/manage-schedule.js';
import type { ScheduleError } from '../domain/use-cases/manage-schedule.js';
import type { ScheduleStatus } from '../domain/types.js';
import { executionResponseSchema } from './schemas.js';

interface CreateScheduleBody {
  name: string;
  schedule: string;
  action: {
    services: string[];
    instruction: string;
    preferredTools?: string[];
  };
  timezone?: string;
}

interface UpdateScheduleBody {
  name?: string;
  schedule?: string;
  status?: ScheduleStatus;
  action?: {
    services: string[];
    instruction: string;
    preferredTools?: string[];
  };
  timezone?: string;
}

interface ScheduleParams {
  id: string;
}

interface ListSchedulesQuery {
  status?: string;
  limit?: string;
  cursor?: string;
}

const scheduleParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string' },
  },
} as const;

const createScheduleBodySchema = {
  type: 'object',
  required: ['name', 'schedule', 'action'],
  properties: {
    name: { type: 'string', minLength: 1 },
    schedule: { type: 'string', minLength: 1 },
    action: {
      type: 'object',
      required: ['services', 'instruction'],
      properties: {
        services: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1 },
        instruction: { type: 'string', minLength: 1 },
        preferredTools: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
        },
      },
    },
    timezone: { type: 'string' },
  },
} as const;

const updateScheduleBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1 },
    schedule: { type: 'string', minLength: 1 },
    status: { type: 'string', enum: ['active', 'paused', 'deleted'] },
    action: {
      type: 'object',
      required: ['services', 'instruction'],
      properties: {
        services: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1 },
        instruction: { type: 'string', minLength: 1 },
        preferredTools: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
        },
      },
    },
    timezone: { type: 'string' },
  },
} as const;

const listSchedulesQuerySchema = {
  type: 'object',
  properties: {
    status: { type: 'string' },
    limit: { type: 'string', pattern: '^[0-9]+$' },
    cursor: { type: 'string' },
  },
} as const;

const scheduleActionSchema = {
  type: 'object',
  properties: {
    services: { type: 'array', items: { type: 'string' } },
    instruction: { type: 'string' },
    preferredTools: { type: 'array', items: { type: 'string' } },
  },
} as const;

const scheduleResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    userId: { type: 'string' },
    name: { type: 'string' },
    scheduleSummary: { type: 'string' },
    cronExpression: { type: 'string' },
    timezone: { type: 'string' },
    action: scheduleActionSchema,
    status: { type: 'string', enum: ['active', 'paused', 'deleted'] },
    lastExecutedAt: { type: ['string', 'null'] },
    nextExecutionAt: { type: ['string', 'null'] },
    executionCount: { type: 'number' },
    failureCount: { type: 'number' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

const serviceToolInfoSchema = {
  type: 'object',
  properties: {
    key: { type: 'string' },
    name: { type: 'string' },
    tools: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          parameters: { type: 'object', additionalProperties: true },
        },
      },
    },
  },
} as const;

function getScheduleManager(): ReturnType<typeof createScheduleManager> {
  const services = getServices();

  return createScheduleManager({
    logger: services.logger,
    scheduleRepo: services.scheduleRepo,
    parseDeps: {
      logger: services.logger,
      geminiClient: services.geminiClient,
    },
    toolRegistry: services.toolRegistry,
    executeDeps: {
      logger: services.logger,
      executionRepo: services.executionRepo,
      scheduleRepo: services.scheduleRepo,
      actionDeps: {
        logger: services.logger,
        toolRegistry: services.toolRegistry,
        toolCallingClient: services.toolCallingClient,
      },
    },
  });
}

function mapErrorCode(code: ScheduleError['code']): 'NOT_FOUND' | 'INVALID_REQUEST' | 'INTERNAL_ERROR' | 'CONFLICT' {
  switch (code) {
    case 'NOT_FOUND':
      return 'NOT_FOUND';
    case 'VALIDATION_ERROR':
    case 'PARSE_FAILED':
      return 'INVALID_REQUEST';
    case 'CONFLICT':
      return 'CONFLICT';
    case 'INTERNAL_ERROR':
      return 'INTERNAL_ERROR';
  }
}

export const scheduleRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.get(
    '/cron/services',
    {
      schema: {
        operationId: 'listCronServices',
        summary: 'List available services and tools',
        description: 'List all services and their tools available for cron schedules.',
        tags: ['cron'],
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            description: 'List of services and tools',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  services: { type: 'array', items: serviceToolInfoSchema },
                },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, { message: 'Received request to GET /cron/services' });
      const auth = await requireAuth(request, reply);
      if (auth === null) return;

      const { toolRegistry } = getServices();
      const services = await toolRegistry.listServiceTools();
      return await reply.ok({ services });
    },
  );

  fastify.get<{ Querystring: ListSchedulesQuery }>(
    '/cron/schedules',
    {
      schema: {
        operationId: 'listSchedules',
        summary: 'List schedules',
        description:
          'List cron schedules for the authenticated user with optional status filter and pagination.',
        tags: ['cron'],
        security: [{ bearerAuth: [] }],
        querystring: listSchedulesQuerySchema,
        response: {
          200: {
            description: 'List of schedules',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  schedules: { type: 'array', items: scheduleResponseSchema },
                  nextCursor: { type: ['string', 'null'] },
                  count: { type: 'number' },
                },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: ListSchedulesQuery }>, reply: FastifyReply) => {
      logIncomingRequest(request, { message: 'Received request to GET /cron/schedules' });
      const auth = await requireAuth(request, reply);
      if (auth === null) return;

      const manager = getScheduleManager();
      const validScheduleStatuses = new Set<string>(['active', 'paused', 'deleted']);
      const statusFilter =
        request.query.status !== undefined
          ? request.query.status.split(',').filter((s): s is ScheduleStatus => validScheduleStatuses.has(s))
          : undefined;
      const parsedLimit =
        request.query.limit !== undefined ? parseInt(request.query.limit, 10) : 20;
      const limit = Math.min(parsedLimit, 100);

      const result = await manager.list(auth.userId, {
        status: statusFilter,
        limit,
        cursor: request.query.cursor,
      });

      if (!result.ok) {
        return await reply.fail(mapErrorCode(result.error.code), result.error.message);
      }

      return await reply.ok(result.value);
    },
  );

  fastify.post<{ Body: CreateScheduleBody }>(
    '/cron/schedules',
    {
      schema: {
        operationId: 'createSchedule',
        summary: 'Create schedule',
        description: 'Create a new cron schedule.',
        tags: ['cron'],
        security: [{ bearerAuth: [] }],
        body: createScheduleBodySchema,
        response: {
          201: {
            description: 'Created schedule',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: scheduleResponseSchema,
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: CreateScheduleBody }>, reply: FastifyReply) => {
      logIncomingRequest(request, { message: 'Received request to POST /cron/schedules' });
      const auth = await requireAuth(request, reply);
      if (auth === null) return;

      const manager = getScheduleManager();
      const result = await manager.create(auth.userId, {
        name: request.body.name,
        schedule: request.body.schedule,
        action: {
          ...request.body.action,
          preferredTools: request.body.action.preferredTools ?? [],
        },
        timezone: request.body.timezone ?? 'UTC',
      });

      if (!result.ok) {
        return await reply.fail(mapErrorCode(result.error.code), result.error.message);
      }

      void reply.status(201);
      return await reply.ok(result.value);
    },
  );

  fastify.get<{ Params: ScheduleParams }>(
    '/cron/schedules/:id',
    {
      schema: {
        operationId: 'getSchedule',
        summary: 'Get schedule',
        description: 'Get a specific cron schedule by ID.',
        tags: ['cron'],
        security: [{ bearerAuth: [] }],
        params: scheduleParamsSchema,
        response: {
          200: {
            description: 'Schedule',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: scheduleResponseSchema,
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: ScheduleParams }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to GET /cron/schedules/:id',
        includeParams: true,
      });
      const auth = await requireAuth(request, reply);
      if (auth === null) return;

      const manager = getScheduleManager();
      const result = await manager.getById(auth.userId, request.params.id);

      if (!result.ok) {
        return await reply.fail(mapErrorCode(result.error.code), result.error.message);
      }

      return await reply.ok(result.value);
    },
  );

  fastify.patch<{ Params: ScheduleParams; Body: UpdateScheduleBody }>(
    '/cron/schedules/:id',
    {
      schema: {
        operationId: 'updateSchedule',
        summary: 'Update schedule',
        description: 'Update an existing cron schedule.',
        tags: ['cron'],
        security: [{ bearerAuth: [] }],
        params: scheduleParamsSchema,
        body: updateScheduleBodySchema,
        response: {
          200: {
            description: 'Updated schedule',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: scheduleResponseSchema,
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: ScheduleParams; Body: UpdateScheduleBody }>,
      reply: FastifyReply,
    ) => {
      logIncomingRequest(request, {
        message: 'Received request to PATCH /cron/schedules/:id',
        includeParams: true,
      });
      const auth = await requireAuth(request, reply);
      if (auth === null) return;

      const manager = getScheduleManager();
      const result = await manager.update(auth.userId, request.params.id, {
        name: request.body.name,
        schedule: request.body.schedule,
        status: request.body.status,
        action: request.body.action !== undefined
          ? { ...request.body.action, preferredTools: request.body.action.preferredTools ?? [] }
          : undefined,
        timezone: request.body.timezone,
      });

      if (!result.ok) {
        return await reply.fail(mapErrorCode(result.error.code), result.error.message);
      }

      return await reply.ok(result.value);
    },
  );

  fastify.delete<{ Params: ScheduleParams }>(
    '/cron/schedules/:id',
    {
      schema: {
        operationId: 'deleteSchedule',
        summary: 'Delete schedule',
        description: 'Soft delete a cron schedule.',
        tags: ['cron'],
        security: [{ bearerAuth: [] }],
        params: scheduleParamsSchema,
        response: {
          200: {
            description: 'Deletion confirmed',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  deleted: { type: 'boolean' },
                },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: ScheduleParams }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to DELETE /cron/schedules/:id',
        includeParams: true,
      });
      const auth = await requireAuth(request, reply);
      if (auth === null) return;

      const manager = getScheduleManager();
      const result = await manager.delete(auth.userId, request.params.id);

      if (!result.ok) {
        return await reply.fail(mapErrorCode(result.error.code), result.error.message);
      }

      return await reply.ok({ deleted: true });
    },
  );

  fastify.post<{ Params: ScheduleParams }>(
    '/cron/schedules/:id/trigger',
    {
      schema: {
        operationId: 'triggerSchedule',
        summary: 'Trigger schedule',
        description: 'Manually trigger a cron schedule execution.',
        tags: ['cron'],
        security: [{ bearerAuth: [] }],
        params: scheduleParamsSchema,
        response: {
          200: {
            description: 'Execution record',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: executionResponseSchema,
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: ScheduleParams }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /cron/schedules/:id/trigger',
        includeParams: true,
      });
      const auth = await requireAuth(request, reply);
      if (auth === null) return;

      const manager = getScheduleManager();
      const result = await manager.trigger(auth.userId, request.params.id);

      if (!result.ok) {
        return await reply.fail(mapErrorCode(result.error.code), result.error.message);
      }

      return await reply.ok(result.value);
    },
  );

  done();
};
