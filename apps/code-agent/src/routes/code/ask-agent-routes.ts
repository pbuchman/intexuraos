/**
 * Ask Agent routes (start / active).
 *
 * Extracted from `codeRoutes.ts` as part of INT-1430 so that route handlers
 * live in resource-specific files and `codeRoutes.ts` can act as a thin
 * Fastify plugin.
 */

import type { FastifyPluginCallback } from 'fastify';
import { logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../../services.js';
import { startAskAgent } from '../../domain/usecases/startAskAgent.js';
import { getActiveAskAgent } from '../../domain/usecases/getActiveAskAgent.js';
import { taskToApiResponse } from './responseFormatters.js';
import type { CodeRoutesOptions } from './types.js';

export const askAgentRoutes: FastifyPluginCallback<CodeRoutesOptions> = (fastify, opts, done) => {
  const { jwtValidator } = opts;

  // ==== Public routes (Auth0 JWT) ====
  fastify.register((fastify) => {
    fastify.addHook('onRequest', jwtValidator);

    fastify.post<{ Body: { prompt: string } }>(
      '/ask-agent/start',
      {
        schema: {
          operationId: 'startAskAgent',
          summary: 'Start an ask-agent task',
          description: 'Creates a new ask-agent task for interactive conversations. Requires Auth0 JWT.',
          tags: ['public'],
          body: {
            type: 'object',
            required: ['prompt'],
            properties: {
              prompt: {
                type: 'string',
                minLength: 1,
                maxLength: 100000,
              },
            },
          },
          response: {
            200: {
              description: 'Task submitted successfully',
              type: 'object',
              required: ['success', 'data'],
              properties: {
                success: { type: 'boolean', enum: [true] },
                data: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', enum: ['submitted'] },
                    codeTaskId: { type: 'string' },
                  },
                  required: ['status', 'codeTaskId'],
                },
              },
            },
            401: {
              description: 'Unauthorized',
              type: 'object',
              required: ['success', 'error'],
              properties: {
                success: { type: 'boolean', enum: [false] },
                error: {
                  type: 'object',
                  required: ['code', 'message'],
                  properties: {
                    code: { type: 'string' },
                    message: { type: 'string' },
                  },
                },
              },
            },
            429: {
              description: 'Rate limit exceeded',
              type: 'object',
              required: ['success', 'error'],
              properties: {
                success: { type: 'boolean', enum: [false] },
                error: {
                  type: 'object',
                  required: ['code', 'message'],
                  properties: {
                    code: {
                      type: 'string',
                      enum: ['concurrent_limit', 'hourly_limit', 'prompt_too_long'],
                    },
                    message: { type: 'string' },
                    retryAfter: { type: 'string' },
                  },
                },
              },
            },
            503: {
              description: 'Service unavailable',
              type: 'object',
              required: ['success', 'error'],
              properties: {
                success: { type: 'boolean', enum: [false] },
                error: {
                  type: 'object',
                  required: ['code', 'message'],
                  properties: {
                    code: { type: 'string', enum: ['MISCONFIGURED', 'QUEUE_FULL', 'WORKER_NOT_CONFIGURED'] },
                    message: { type: 'string' },
                  },
                },
              },
            },
            500: {
              description: 'Internal server error',
              type: 'object',
              required: ['success', 'error'],
              properties: {
                success: { type: 'boolean', enum: [false] },
                error: {
                  type: 'object',
                  required: ['code', 'message'],
                  properties: {
                    code: { type: 'string' },
                    message: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
      async (request, reply) => {
        logIncomingRequest(request, {
          message: 'Received request to POST /code/ask-agent/start',
          includeParams: true,
        });

        const { codeTaskRepo, workerSettingsRepo, taskEnqueueService } = getServices();
        /* v8 ignore start -- ts-type: FakeAuthPlugin always provides userId — ?? fallback unreachable @preserve */
        const userId = request.user?.userId ?? 'unknown-user';
        /* v8 ignore stop @preserve */

        const result = await startAskAgent(
          { logger: request.log, codeTaskRepo, workerSettingsRepo, taskEnqueueService },
          { userId, prompt: request.body.prompt },
        );

        if (!result.ok) {
          const { error } = result;
          if (error.code === 'worker_not_configured') return await reply.fail('WORKER_NOT_CONFIGURED', error.message);
          if (error.code === 'duplicate_prompt') return await reply.fail('CONFLICT', error.message);
          if (error.code === 'queue_full') return await reply.fail('QUEUE_FULL', error.message);
          return await reply.fail('INTERNAL_ERROR', error.message);
        }

        return await reply.ok(result.value);
      },
    );

    fastify.get(
      '/ask-agent/active',
      {
        schema: {
          operationId: 'getActiveAskAgent',
          summary: 'Get the active ask-agent conversation',
          description: 'Returns the user\'s most recent non-archived ask-agent task for cross-device conversation restoration. Requires Auth0 JWT.',
          tags: ['public'],
          response: {
            200: {
              description: 'Active ask-agent task or null',
              type: 'object',
              required: ['success', 'data'],
              properties: {
                success: { type: 'boolean', enum: [true] },
                data: {
                  type: 'object',
                  properties: {
                    task: {
                      oneOf: [
                        { type: 'null' },
                        {
                          type: 'object',
                          properties: {
                            id: { type: 'string' },
                            status: { type: 'string' },
                            agentType: { type: 'string' },
                            prompt: { type: 'string' },
                            createdAt: { type: 'string' },
                          },
                        },
                      ],
                    },
                  },
                  required: ['task'],
                },
              },
            },
          },
        },
      },
      async (request, reply) => {
        logIncomingRequest(request, {
          message: 'Received request to GET /code/ask-agent/active',
        });

        const { codeTaskRepo } = getServices();
        /* v8 ignore start -- ts-type: FakeAuthPlugin always provides userId — ?? fallback unreachable @preserve */
        const userId = request.user?.userId ?? 'unknown-user';
        /* v8 ignore stop @preserve */

        const result = await getActiveAskAgent(
          { logger: request.log, codeTaskRepo },
          { userId },
        );

        if (!result.ok) {
          return await reply.fail('INTERNAL_ERROR', result.error.message);
        }

        const task = result.value.task; // @allow-result-access -- narrowed by !result.ok guard above
        return await reply.ok({
          task: task !== null ? taskToApiResponse(task) : null,
        });
      },
    );
  });

  done();
};
