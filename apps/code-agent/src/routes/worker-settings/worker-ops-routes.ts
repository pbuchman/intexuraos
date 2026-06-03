/**
 * Worker operations sub-plugin.
 *
 * Registers per-worker non-CRUD operations:
 * - `POST /code/worker-settings/workers/:name/test` — probe a worker's
 *   `/health` endpoint and persist the result.
 * - `PUT /code/worker-settings/priority` — reorder the user's workers by
 *   priority.
 *
 * Connectivity testing is delegated to the `testWorkerConnectivity` use
 * case so the route only deals with HTTP concerns (status mapping and
 * response shaping).
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../../services.js';
import type { JwtValidator } from '../codeRoutes.js';
import { createTestWorkerConnectivityUseCase } from '../../domain/usecases/workerSettings/testWorkerConnectivity.js';
import { reorderSchema } from './schemas.js';

export interface WorkerOpsRoutesOptions {
  jwtValidator: JwtValidator;
}

export const workerOpsRoutes: FastifyPluginCallback<WorkerOpsRoutesOptions> = (
  fastify,
  opts,
  done
) => {
  const { jwtValidator } = opts;

  // POST /code/worker-settings/workers/:name/test - Test worker connectivity
  fastify.post<{
    Params: { name: string };
  }>(
    '/worker-settings/workers/:name/test',
    {
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      onRequest: jwtValidator,
      schema: {
        operationId: 'testWorkerConnectivity',
        summary: 'Test worker connectivity',
        description: 'Test connection to configured worker. Updates test status in settings. Requires Auth0 JWT.',
        tags: ['public', 'worker-settings'],
        params: {
          type: 'object',
          properties: {
            name: { type: 'string' },
          },
          required: ['name'],
        },
        response: {
          200: {
            description: 'Test completed',
            type: 'object',
            required: ['success', 'data'],
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  testStatus: { type: 'string', enum: ['success', 'failure'] },
                  testMessage: { type: 'string' },
                  lastTestedAt: { type: 'string', format: 'date-time' },
                },
                required: ['testStatus', 'lastTestedAt'],
              },
            },
          },
          400: {
            description: 'Invalid request',
            type: 'object',
            required: ['success', 'error'],
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: {
                type: 'object',
                required: ['code', 'message'],
                properties: {
                  code: { type: 'string', enum: ['INVALID_REQUEST', 'NOT_FOUND'] },
                  message: { type: 'string' },
                },
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
                  code: { type: 'string', enum: ['UNAUTHORIZED'] },
                  message: { type: 'string' },
                },
              },
            },
          },
          404: {
            description: 'Worker config not found',
            type: 'object',
            required: ['success', 'error'],
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: {
                type: 'object',
                required: ['code', 'message'],
                properties: {
                  code: { type: 'string', enum: ['NOT_FOUND'] },
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
                  code: { type: 'string', enum: ['INTERNAL_ERROR'] },
                  message: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /code/worker-settings/workers/:name/test',
        includeParams: true,
      });

      const { workerSettingsRepo } = getServices();
      const userId = request.user?.userId ?? 'unknown-user';
      const { name } = request.params;

      request.log.info({ userId, name }, 'Testing worker connectivity');

      const testUseCase = createTestWorkerConnectivityUseCase({
        workerSettingsRepo,
        logger: request.log,
      });

      const result = await testUseCase({ userId, workerName: name });

      if (!result.ok) {
        const codeMap: Record<'not_found' | 'internal_error', 'NOT_FOUND' | 'INTERNAL_ERROR'> = {
          not_found: 'NOT_FOUND',
          internal_error: 'INTERNAL_ERROR',
        };
        return await reply.fail(codeMap[result.error.code], result.error.message);
      }

      return await reply.ok(result.value);
    }
  );

  // PUT /code/worker-settings/priority - Reorder workers
  fastify.put<{
    Body: { workerNames: string[] };
  }>(
    '/worker-settings/priority',
    {
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      onRequest: jwtValidator,
      schema: {
        operationId: 'reorderWorkers',
        summary: 'Reorder workers',
        description: 'Reorder workers by priority. First in array = primary worker. Requires Auth0 JWT.',
        tags: ['public', 'worker-settings'],
        body: reorderSchema,
        response: {
          200: {
            description: 'Workers reordered',
            type: 'object',
            required: ['success', 'data'],
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  reordered: { type: 'boolean', enum: [true] },
                },
                required: ['reordered'],
              },
            },
          },
          400: {
            description: 'Invalid request',
            type: 'object',
            required: ['success', 'error'],
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: {
                type: 'object',
                required: ['code', 'message'],
                properties: {
                  code: { type: 'string', enum: ['INVALID_REQUEST'] },
                  message: { type: 'string' },
                },
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
                  code: { type: 'string', enum: ['UNAUTHORIZED'] },
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
                  code: { type: 'string', enum: ['INTERNAL_ERROR'] },
                  message: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: { workerNames: string[] } }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to PUT /code/worker-settings/priority',
      });

      const { workerSettingsRepo } = getServices();
      const userId = request.user?.userId ?? 'unknown-user';
      const { workerNames } = request.body;

      request.log.info({ userId, workerNames }, 'Reordering workers');

      const result = await workerSettingsRepo.reorderWorkers(userId, workerNames);

      if (!result.ok) {
        request.log.error({ error: result.error }, 'Failed to reorder workers');
        return await reply.fail('INVALID_REQUEST', result.error.message);
      }

      request.log.info({ userId, workerNames }, 'Workers reordered successfully');

      return await reply.ok({ reordered: true });
    }
  );

  done();
};
