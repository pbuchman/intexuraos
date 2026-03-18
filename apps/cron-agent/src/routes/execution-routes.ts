import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import type { ExecutionStatus } from '../domain/types.js';
import { executionResponseSchema } from './schemas.js';

interface ExecutionParams {
  id: string;
}

interface ListExecutionsQuery {
  scheduleId?: string;
  status?: string;
  limit?: string;
  cursor?: string;
}

const executionParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string' },
  },
} as const;

const listExecutionsQuerySchema = {
  type: 'object',
  properties: {
    scheduleId: { type: 'string' },
    status: { type: 'string' },
    limit: { type: 'string', pattern: '^[0-9]+$' },
    cursor: { type: 'string' },
  },
} as const;

export const executionRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.get<{ Querystring: ListExecutionsQuery }>(
    '/cron/executions',
    {
      schema: {
        operationId: 'listExecutions',
        summary: 'List executions',
        description:
          'List cron executions for the authenticated user with optional scheduleId and status filters.',
        tags: ['cron'],
        security: [{ bearerAuth: [] }],
        querystring: listExecutionsQuerySchema,
        response: {
          200: {
            description: 'List of executions',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  executions: { type: 'array', items: executionResponseSchema },
                  nextCursor: { type: ['string', 'null'] },
                  total: { type: 'number' },
                },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: ListExecutionsQuery }>, reply: FastifyReply) => {
      logIncomingRequest(request, { message: 'Received request to GET /cron/executions' });
      const auth = await requireAuth(request, reply);
      if (auth === null) return;

      const { executionRepo } = getServices();
      const statusFilter =
        request.query.status !== undefined
          ? (request.query.status.split(',') as ExecutionStatus[])
          : undefined;
      const parsedLimit =
        request.query.limit !== undefined ? parseInt(request.query.limit, 10) : 20;
      const limit = Math.min(parsedLimit, 100);

      const result = await executionRepo.findByUserId(auth.userId, {
        scheduleId: request.query.scheduleId,
        status: statusFilter,
        limit,
        cursor: request.query.cursor,
      });

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok(result.value);
    },
  );

  fastify.get<{ Params: ExecutionParams }>(
    '/cron/executions/:id',
    {
      schema: {
        operationId: 'getExecution',
        summary: 'Get execution',
        description: 'Get a specific cron execution by ID.',
        tags: ['cron'],
        security: [{ bearerAuth: [] }],
        params: executionParamsSchema,
        response: {
          200: {
            description: 'Execution',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: executionResponseSchema,
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: ExecutionParams }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to GET /cron/executions/:id',
        includeParams: true,
      });
      const auth = await requireAuth(request, reply);
      if (auth === null) return;

      const { executionRepo } = getServices();
      const result = await executionRepo.findById(request.params.id);

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      if (result.value === null) {
        return await reply.fail('NOT_FOUND', 'Execution not found');
      }

      if (result.value.userId !== auth.userId) {
        return await reply.fail('NOT_FOUND', 'Execution not found');
      }

      return await reply.ok(result.value);
    },
  );

  done();
};
