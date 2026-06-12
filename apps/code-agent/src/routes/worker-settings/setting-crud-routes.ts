/**
 * CRUD sub-plugin for worker settings.
 *
 * Registers:
 * - `GET /code/worker-settings` — list current settings with masked secrets
 * - `POST /code/worker-settings/workers` — add a new worker config
 * - `PATCH /code/worker-settings/workers/:name` — partial update of a worker
 * - `DELETE /code/worker-settings/workers/:name` — remove a worker
 *
 * Handlers delegate all business logic to the `workerSettingsRepo`; the only
 * in-handler work is request parsing, credential-mask validation, and
 * mapping domain errors to HTTP codes.
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest } from '@intexuraos/common-http';
import { CODE_TASK_WORKER_TYPES } from '@intexuraos/code-task-domain';
import { getServices } from '../../services.js';
import type { JwtValidator } from '../codeRoutes.js';
import type {
  UserWorkerSettingsResponse,
  WorkerConfigInput,
  WorkerConfigUpdateInput,
} from '../../domain/models/workerSettings.js';
import { WORKER_NAME_REGEX } from '../../domain/models/workerSettings.js';
import {
  maskWorkerConfig,
  validateCredentialsNotMasked,
} from '../../domain/services/workerSecretMasking.js';
import {
  addWorkerSchema,
  maskedWorkerConfigSchema,
  updateWorkerSchema,
} from './schemas.js';

export interface SettingCrudRoutesOptions {
  jwtValidator: JwtValidator;
}

export const settingCrudRoutes: FastifyPluginCallback<SettingCrudRoutesOptions> = (
  fastify,
  opts,
  done
) => {
  const { jwtValidator } = opts;

  // GET /code/worker-settings - Get user's worker settings (secrets masked)
  fastify.get(
    '/worker-settings',
    {
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      onRequest: jwtValidator,
      schema: {
        operationId: 'getWorkerSettings',
        summary: 'Get user worker settings',
        description: 'Get current worker configuration with masked secrets. Requires Auth0 JWT.',
        tags: ['public', 'worker-settings'],
        response: {
          200: {
            description: 'Worker settings retrieved',
            type: 'object',
            required: ['success', 'data'],
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  workers: {
                    type: 'array',
                    items: maskedWorkerConfigSchema,
                  },
                  defaultReviewWorkerType: { type: 'string', enum: [...CODE_TASK_WORKER_TYPES] },
                  defaultRemediationWorkerType: { type: 'string', enum: [...CODE_TASK_WORKER_TYPES] },
                  defaultExecutionWorkerType: { type: 'string', enum: [...CODE_TASK_WORKER_TYPES] },
                  defaultPlanningWorkerType: { type: 'string', enum: [...CODE_TASK_WORKER_TYPES] },
                  defaultPullRequestWorkerType: { type: 'string', enum: [...CODE_TASK_WORKER_TYPES] },
                },
                required: ['workers'],
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
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to GET /code/worker-settings',
      });

      const { workerSettingsRepo } = getServices();
      /* v8 ignore start -- ts-type: FakeAuthPlugin always provides userId — ?? fallback unreachable @preserve */
      const userId = request.user?.userId ?? 'unknown-user';
      /* v8 ignore stop @preserve */

      request.log.info({ userId }, 'Getting worker settings');

      const result = await workerSettingsRepo.getSettings(userId);

      if (!result.ok) {
        request.log.error({ error: result.error }, 'Failed to get worker settings');
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      const settings = result.value;

      const response: UserWorkerSettingsResponse = {
        workers: settings?.workers.map(maskWorkerConfig) ?? [],
        ...(settings?.defaultReviewWorkerType !== undefined && {
          defaultReviewWorkerType: settings.defaultReviewWorkerType,
        }),
        ...(settings?.defaultRemediationWorkerType !== undefined && {
          defaultRemediationWorkerType: settings.defaultRemediationWorkerType,
        }),
        ...(settings?.defaultExecutionWorkerType !== undefined && {
          defaultExecutionWorkerType: settings.defaultExecutionWorkerType,
        }),
        ...(settings?.defaultPlanningWorkerType !== undefined && {
          defaultPlanningWorkerType: settings.defaultPlanningWorkerType,
        }),
        ...(settings?.defaultPullRequestWorkerType !== undefined && {
          defaultPullRequestWorkerType: settings.defaultPullRequestWorkerType,
        }),
      };

      return await reply.ok(response);
    }
  );

  // POST /code/worker-settings/workers - Add new worker
  fastify.post<{
    Body: WorkerConfigInput;
  }>(
    '/worker-settings/workers',
    {
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      onRequest: jwtValidator,
      schema: {
        operationId: 'addWorker',
        summary: 'Add new worker',
        description: 'Add a new worker configuration. Requires Auth0 JWT.',
        tags: ['public', 'worker-settings'],
        body: addWorkerSchema,
        response: {
          200: {
            description: 'Worker added',
            type: 'object',
            required: ['success', 'data'],
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  added: { type: 'boolean', enum: [true] },
                },
                required: ['added'],
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
          409: {
            description: 'Conflict - max workers exceeded or worker already exists',
            type: 'object',
            required: ['success', 'error'],
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: {
                type: 'object',
                required: ['code', 'message'],
                properties: {
                  code: { type: 'string', enum: ['CONFLICT'] },
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
    async (request: FastifyRequest<{ Body: WorkerConfigInput }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /code/worker-settings/workers',
      });

      const { workerSettingsRepo } = getServices();
      const userId = request.user?.userId ?? 'unknown-user';
      const { name } = request.body;

      // Validate worker name
      if (!WORKER_NAME_REGEX.test(name)) {
        return await reply.fail(
          'INVALID_REQUEST',
          'Worker name must be 3-32 chars, lowercase alphanumeric with hyphens, start/end with letter or number'
        );
      }

      // Validate credentials are not masked values (security: prevent storing display-only data)
      const maskedError = validateCredentialsNotMasked(request.body);
      if (maskedError !== undefined) {
        return await reply.fail('INVALID_REQUEST', maskedError);
      }

      request.log.info({ userId, name }, 'Adding worker');

      const result = await workerSettingsRepo.addWorker(userId, request.body);

      if (!result.ok) {
        request.log.error({ error: result.error }, 'Failed to add worker');
        const codeMap: Record<string, 'INVALID_REQUEST' | 'CONFLICT' | 'INTERNAL_ERROR'> = {
          max_workers_exceeded: 'CONFLICT',
          already_exists: 'CONFLICT',
          internal_error: 'INTERNAL_ERROR',
        };
        return await reply.fail(codeMap[result.error.code] ?? 'INTERNAL_ERROR', result.error.message);
      }

      request.log.info({ userId, name }, 'Worker added successfully');

      return await reply.ok({ added: true });
    }
  );

  // PATCH /code/worker-settings/workers/:name - Update worker
  fastify.patch<{
    Params: { name: string };
    Body: WorkerConfigUpdateInput;
  }>(
    '/worker-settings/workers/:name',
    {
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      onRequest: jwtValidator,
      schema: {
        operationId: 'updateWorker',
        summary: 'Update worker configuration',
        description: 'Update configuration for a specific worker. Requires Auth0 JWT.',
        tags: ['public', 'worker-settings'],
        params: {
          type: 'object',
          properties: {
            name: { type: 'string' },
          },
          required: ['name'],
        },
        body: updateWorkerSchema,
        response: {
          200: {
            description: 'Worker updated',
            type: 'object',
            required: ['success', 'data'],
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  updated: { type: 'boolean', enum: [true] },
                },
                required: ['updated'],
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
    async (
      request: FastifyRequest<{ Params: { name: string }; Body: WorkerConfigUpdateInput }>,
      reply: FastifyReply
    ) => {
      logIncomingRequest(request, {
        message: 'Received request to PATCH /code/worker-settings/workers/:name',
        includeParams: true,
      });

      const { workerSettingsRepo } = getServices();
      const userId = request.user?.userId ?? 'unknown-user';
      const { name } = request.params;

      // Validate credentials are not masked values (security: prevent storing display-only data)
      const maskedError = validateCredentialsNotMasked(request.body);
      if (maskedError !== undefined) {
        return await reply.fail('INVALID_REQUEST', maskedError);
      }

      request.log.info({ userId, name }, 'Updating worker');

      const result = await workerSettingsRepo.updateWorker(userId, name, request.body);

      if (!result.ok) {
        request.log.error({ error: result.error }, 'Failed to update worker');
        const codeMap: Record<string, 'INVALID_REQUEST' | 'NOT_FOUND' | 'INTERNAL_ERROR'> = {
          not_found: 'NOT_FOUND',
          internal_error: 'INTERNAL_ERROR',
        };
        return await reply.fail(codeMap[result.error.code] ?? 'INTERNAL_ERROR', result.error.message);
      }

      request.log.info({ userId, name }, 'Worker updated successfully');

      return await reply.ok({ updated: true });
    }
  );

  // DELETE /code/worker-settings/workers/:name - Delete worker
  fastify.delete<{
    Params: { name: string };
  }>(
    '/worker-settings/workers/:name',
    {
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      onRequest: jwtValidator,
      schema: {
        operationId: 'deleteWorker',
        summary: 'Delete worker configuration',
        description: 'Delete configuration for a specific worker. Requires Auth0 JWT.',
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
            description: 'Worker deleted',
            type: 'object',
            required: ['success', 'data'],
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  deleted: { type: 'boolean', enum: [true] },
                },
                required: ['deleted'],
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
        message: 'Received request to DELETE /code/worker-settings/workers/:name',
        includeParams: true,
      });

      const { workerSettingsRepo } = getServices();
      const userId = request.user?.userId ?? 'unknown-user';
      const { name } = request.params;

      request.log.info({ userId, name }, 'Deleting worker');

      const result = await workerSettingsRepo.deleteWorker(userId, name);

      if (!result.ok) {
        request.log.error({ error: result.error }, 'Failed to delete worker');
        const codeMap: Record<string, 'INVALID_REQUEST' | 'NOT_FOUND' | 'INTERNAL_ERROR'> = {
          not_found: 'NOT_FOUND',
          internal_error: 'INTERNAL_ERROR',
        };
        return await reply.fail(codeMap[result.error.code] ?? 'INTERNAL_ERROR', result.error.message);
      }

      request.log.info({ userId, name }, 'Worker deleted successfully');

      return await reply.ok({ deleted: true });
    }
  );

  done();
};
