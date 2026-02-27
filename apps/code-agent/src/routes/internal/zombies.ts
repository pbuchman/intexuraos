/**
 * GET /internal/code-tasks/zombies route.
 *
 * Internal endpoint for finding stale tasks that may have died (zombie detection).
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import { getServices } from '../../services.js';
import { codeTaskSchema, taskToApiResponse } from '../shared.js';

const zombiesRoute: FastifyPluginCallback = (fastify, _opts, done) => {
  // GET /internal/code-tasks/zombies - Find zombie tasks
  fastify.get<{
    Querystring: { staleThresholdMinutes: number };
  }>(
    '/internal/code-tasks/zombies',
    {
      schema: {
        operationId: 'findZombieCodeTasks',
        summary: 'Find zombie tasks',
        description: 'Internal endpoint for finding stale tasks that may have died (zombie detection).',
        tags: ['internal'],
        querystring: {
          type: 'object',
          properties: {
            staleThresholdMinutes: {
              type: 'number',
              minimum: 1,
              description: 'Tasks updated more than this many minutes ago are considered stale',
            },
          },
          required: ['staleThresholdMinutes'],
        },
        response: {
          200: {
            description: 'List of zombie tasks',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  tasks: {
                    type: 'array',
                    items: codeTaskSchema,
                  },
                },
                required: ['tasks'],
              },
            },
            required: ['success', 'data'],
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  message: { type: 'string' },
                },
                required: ['code', 'message'],
              },
            },
            required: ['success', 'error'],
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Querystring: { staleThresholdMinutes: number } }>,
      reply: FastifyReply
    ) => {
      logIncomingRequest(request, {
        message: 'Received request to GET /internal/code-tasks/zombies',
      });

      // Validate internal auth
      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Internal auth failed for code tasks');
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      const { codeTaskRepo } = getServices();
      const { staleThresholdMinutes } = request.query;

      const staleThreshold = new Date(Date.now() - staleThresholdMinutes * 60 * 1000);

      request.log.info({ staleThresholdMinutes, staleThreshold }, 'Finding zombie code tasks');

      const result = await codeTaskRepo.findZombieTasks(staleThreshold);

      if (!result.ok) {
        request.log.error({ staleThreshold, error: result.error }, 'Failed to find zombie code tasks');
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      request.log.info({ count: result.value.length }, 'Zombie code tasks found');

      return await reply.ok({
        tasks: result.value.map(taskToApiResponse),
      });
    }
  );

  done();
};

export default zombiesRoute;
