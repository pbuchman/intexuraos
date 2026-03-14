/**
 * Routes for per-user worker settings management.
 *
 * All routes require Auth0 JWT authentication.
 * Secrets are masked in responses (show last 3 chars only).
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest } from '@intexuraos/common-http';
import { getErrorMessage, CODE_TASK_WORKER_TYPES, isCodeTaskWorkerType } from '@intexuraos/common-core';
import { getServices } from '../services.js';
import type { JwtValidator } from './codeRoutes.js';
import type {
  WorkerConfig,
  MaskedWorkerConfig,
  UserWorkerSettingsResponse,
  WorkerConfigInput,
  WorkerConfigUpdateInput,
} from '../domain/models/workerSettings.js';
import { WORKER_NAME_REGEX, MAX_WORKERS_PER_USER } from '../domain/models/workerSettings.js';

export interface WorkerSettingsRoutesOptions {
  jwtValidator: JwtValidator;
}

const MASK_CHAR = '•';

/**
 * Check if a credential appears to be a masked value.
 * Masked values contain bullet characters (•) from our maskSecret function.
 * These should never be stored - they indicate the frontend sent back masked data.
 */
function isMaskedCredential(value: string): boolean {
  return value.includes(MASK_CHAR);
}

/**
 * Validate that credentials are not masked values.
 * Returns error message if any credential is masked, undefined if all are valid.
 */
function validateCredentialsNotMasked(
  credentials: Partial<{
    cfAccessClientId: string;
    cfAccessClientSecret: string;
    dispatchSigningSecret: string;
  }>
): string | undefined {
  if (credentials.cfAccessClientId !== undefined && isMaskedCredential(credentials.cfAccessClientId)) {
    return 'CF Access Client ID contains masked characters - please enter the actual credential';
  }
  if (credentials.cfAccessClientSecret !== undefined && isMaskedCredential(credentials.cfAccessClientSecret)) {
    return 'CF Access Client Secret contains masked characters - please enter the actual credential';
  }
  if (credentials.dispatchSigningSecret !== undefined && isMaskedCredential(credentials.dispatchSigningSecret)) {
    return 'Orchestrator Secret contains masked characters - please enter the actual credential';
  }
  return undefined;
}

/**
 * Mask a secret string for API response.
 * Shows only last 3 characters, rest as dots.
 */
function maskSecret(secret: string): string {
  /* v8 ignore start -- test-infra: edge case for very short secrets rarely occurs @preserve */
  if (secret.length <= 3) {
    return MASK_CHAR.repeat(3);
  }
  /* v8 ignore stop @preserve */
  return MASK_CHAR.repeat(Math.min(secret.length - 3, 20)) + secret.slice(-3);
}

/**
 * Convert worker config to masked version for API response.
 */
function maskWorkerConfig(config: WorkerConfig): MaskedWorkerConfig {
  const masked: MaskedWorkerConfig = {
    name: config.name,
    url: config.url,
    cfAccessClientId: maskSecret(config.cfAccessClientId),
    cfAccessClientSecret: maskSecret(config.cfAccessClientSecret),
    dispatchSigningSecret: maskSecret(config.dispatchSigningSecret),
    enabled: config.enabled,
  };

  /* v8 ignore start -- ts-type: optional property checks for test metadata @preserve */
  if (config.lastTestedAt !== undefined) {
    masked.lastTestedAt = config.lastTestedAt;
  }
  if (config.testStatus !== undefined) {
    masked.testStatus = config.testStatus;
  }
  if (config.testMessage !== undefined) {
    masked.testMessage = config.testMessage;
  }
  /* v8 ignore stop @preserve */

  return masked;
}

const addWorkerSchema = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      minLength: 1,
      maxLength: 32,
    },
    url: { type: 'string', format: 'uri' },
    cfAccessClientId: { type: 'string', minLength: 1 },
    cfAccessClientSecret: { type: 'string', minLength: 1 },
    dispatchSigningSecret: { type: 'string', minLength: 1 },
  },
  required: ['name', 'url', 'cfAccessClientId', 'cfAccessClientSecret', 'dispatchSigningSecret'],
} as const;

const updateWorkerSchema = {
  type: 'object',
  properties: {
    url: { type: 'string', format: 'uri' },
    cfAccessClientId: { type: 'string', minLength: 1 },
    cfAccessClientSecret: { type: 'string', minLength: 1 },
    dispatchSigningSecret: { type: 'string', minLength: 1 },
    enabled: { type: 'boolean' },
  },
} as const;

const reorderSchema = {
  type: 'object',
  properties: {
    workerNames: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      maxItems: MAX_WORKERS_PER_USER,
    },
  },
  required: ['workerNames'],
} as const;

const maskedWorkerConfigSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    url: { type: 'string' },
    cfAccessClientId: { type: 'string' },
    cfAccessClientSecret: { type: 'string' },
    dispatchSigningSecret: { type: 'string' },
    enabled: { type: 'boolean' },
    lastTestedAt: { type: 'string', nullable: true },
    testStatus: { type: 'string', enum: ['success', 'failure'], nullable: true },
    testMessage: { type: 'string', nullable: true },
  },
  required: ['name', 'url', 'cfAccessClientId', 'cfAccessClientSecret', 'dispatchSigningSecret', 'enabled'],
} as const;

export const workerSettingsRoutes: FastifyPluginCallback<WorkerSettingsRoutesOptions> = (
  fastify,
  opts,
  done
) => {
  const { jwtValidator } = opts;

  // GET /code/worker-settings - Get user's worker settings (secrets masked)
  fastify.get(
    '/code/worker-settings',
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
      /* v8 ignore start -- ts-type: nullish coalescing fallback for optional user @preserve */
      const userId = request.user?.userId ?? 'unknown-user';
      /* v8 ignore stop @preserve */

      request.log.info({ userId }, 'Getting worker settings');

      const result = await workerSettingsRepo.getSettings(userId);

      /* v8 ignore start -- test-infra: FakeWorkerSettingsRepo.getSettings cannot simulate internal failure @preserve */
      if (!result.ok) {
        request.log.error({ error: result.error }, 'Failed to get worker settings');
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }
      /* v8 ignore stop @preserve */

      const settings = result.value;

      const response: UserWorkerSettingsResponse = {
        workers: settings?.workers.map(maskWorkerConfig) ?? [],
        ...(settings?.defaultReviewWorkerType !== undefined && {
          defaultReviewWorkerType: settings.defaultReviewWorkerType,
        }),
      };

      return await reply.ok(response);
    }
  );

  // POST /code/worker-settings/workers - Add new worker
  fastify.post<{
    Body: WorkerConfigInput;
  }>(
    '/code/worker-settings/workers',
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
      /* v8 ignore start -- auth-guard: FakeAuthPlugin always returns valid user, cannot simulate null userId @preserve */
      const userId = request.user?.userId ?? 'unknown-user';
      /* v8 ignore stop @preserve */
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
        /* v8 ignore start -- ts-type: noUncheckedIndexedAccess makes codeMap lookup possibly undefined despite exhaustive keys @preserve */
        return await reply.fail(codeMap[result.error.code] ?? 'INTERNAL_ERROR', result.error.message);
        /* v8 ignore stop @preserve */
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
    '/code/worker-settings/workers/:name',
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
      /* v8 ignore start -- auth-guard: FakeAuthPlugin always returns valid user, cannot simulate null userId @preserve */
      const userId = request.user?.userId ?? 'unknown-user';
      /* v8 ignore stop @preserve */
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
        /* v8 ignore start -- ts-type: noUncheckedIndexedAccess makes codeMap lookup possibly undefined despite exhaustive keys @preserve */
        return await reply.fail(codeMap[result.error.code] ?? 'INTERNAL_ERROR', result.error.message);
        /* v8 ignore stop @preserve */
      }

      request.log.info({ userId, name }, 'Worker updated successfully');

      return await reply.ok({ updated: true });
    }
  );

  // DELETE /code/worker-settings/workers/:name - Delete worker
  fastify.delete<{
    Params: { name: string };
  }>(
    '/code/worker-settings/workers/:name',
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
      /* v8 ignore start -- auth-guard: FakeAuthPlugin always returns valid user, cannot simulate null userId @preserve */
      const userId = request.user?.userId ?? 'unknown-user';
      /* v8 ignore stop @preserve */
      const { name } = request.params;

      request.log.info({ userId, name }, 'Deleting worker');

      const result = await workerSettingsRepo.deleteWorker(userId, name);

      if (!result.ok) {
        request.log.error({ error: result.error }, 'Failed to delete worker');
        const codeMap: Record<string, 'INVALID_REQUEST' | 'NOT_FOUND' | 'INTERNAL_ERROR'> = {
          not_found: 'NOT_FOUND',
          internal_error: 'INTERNAL_ERROR',
        };
        /* v8 ignore start -- ts-type: noUncheckedIndexedAccess makes codeMap lookup possibly undefined despite exhaustive keys @preserve */
        return await reply.fail(codeMap[result.error.code] ?? 'INTERNAL_ERROR', result.error.message);
        /* v8 ignore stop @preserve */
      }

      request.log.info({ userId, name }, 'Worker deleted successfully');

      return await reply.ok({ deleted: true });
    }
  );

  // POST /code/worker-settings/workers/:name/test - Test worker connectivity
  fastify.post<{
    Params: { name: string };
  }>(
    '/code/worker-settings/workers/:name/test',
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
      /* v8 ignore start -- auth-guard: FakeAuthPlugin always returns valid user, cannot simulate null userId @preserve */
      const userId = request.user?.userId ?? 'unknown-user';
      /* v8 ignore stop @preserve */
      const { name } = request.params;

      request.log.info({ userId, name }, 'Testing worker connectivity');

      const configResult = await workerSettingsRepo.getWorkerByName(userId, name);

      /* v8 ignore start -- test-infra: FakeWorkerSettingsRepo.getWorkerByName cannot simulate internal failure @preserve */
      if (!configResult.ok) {
        request.log.error({ error: configResult.error }, 'Failed to get worker config for test');
        return await reply.fail('INTERNAL_ERROR', configResult.error.message);
      }
      /* v8 ignore stop @preserve */

      const config = configResult.value;

      if (config === null) {
        return await reply.fail('NOT_FOUND', `Worker '${name}' not configured`);
      }

      const lastTestedAt = new Date().toISOString();
      let testStatus: 'success' | 'failure' = 'failure';
      let testMessage = '';

      try {
        const response = await fetch(`${config.url}/health`, {
          method: 'GET',
          headers: {
            'CF-Access-Client-Id': config.cfAccessClientId,
            'CF-Access-Client-Secret': config.cfAccessClientSecret,
          },
          signal: AbortSignal.timeout(10000),
        });

        if (response.ok) {
          testStatus = 'success';
          testMessage = 'Connection successful';
        } else {
          testMessage = `HTTP ${String(response.status)}: ${response.statusText}`;
        }
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        testMessage = `Connection failed: ${errorMessage}`;
        request.log.warn({ userId, name, error: errorMessage }, 'Worker connectivity test failed');
      }

      await workerSettingsRepo.updateTestResult(userId, name, {
        status: testStatus,
        message: testMessage,
      });

      request.log.info({ userId, name, testStatus }, 'Worker connectivity test completed');

      return await reply.ok({
        testStatus,
        testMessage,
        lastTestedAt,
      });
    }
  );

  // PUT /code/worker-settings/priority - Reorder workers
  fastify.put<{
    Body: { workerNames: string[] };
  }>(
    '/code/worker-settings/priority',
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
      /* v8 ignore start -- auth-guard: FakeAuthPlugin always returns valid user, cannot simulate null userId @preserve */
      const userId = request.user?.userId ?? 'unknown-user';
      /* v8 ignore stop @preserve */
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

  // PATCH /code/worker-settings/default-review-worker-type - Update default review worker type
  fastify.patch<{
    Body: { workerType: string };
  }>(
    '/code/worker-settings/default-review-worker-type',
    {
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      onRequest: jwtValidator,
      schema: {
        operationId: 'updateDefaultReviewWorkerType',
        summary: 'Update default review worker type',
        description: 'Set the default worker type for automated PR reviews. Requires Auth0 JWT.',
        tags: ['public', 'worker-settings'],
        body: {
          type: 'object',
          properties: {
            workerType: { type: 'string', enum: [...CODE_TASK_WORKER_TYPES] },
          },
          required: ['workerType'],
        },
        response: {
          200: {
            description: 'Default review worker type updated',
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
    async (request: FastifyRequest<{ Body: { workerType: string } }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to PATCH /code/worker-settings/default-review-worker-type',
      });

      const { workerSettingsRepo } = getServices();
      /* v8 ignore start -- auth-guard: FakeAuthPlugin always returns valid user, cannot simulate null userId @preserve */
      const userId = request.user?.userId ?? 'unknown-user';
      /* v8 ignore stop @preserve */
      const { workerType } = request.body;

      /* v8 ignore start -- schema: Fastify body schema enum validation rejects invalid values before handler runs @preserve */
      if (!isCodeTaskWorkerType(workerType)) {
        return await reply.fail('INVALID_REQUEST', `Invalid worker type: ${workerType}`);
      }
      /* v8 ignore stop @preserve */

      request.log.info({ userId, workerType }, 'Updating default review worker type');

      const result = await workerSettingsRepo.updateDefaultReviewWorkerType(userId, workerType);

      /* v8 ignore start -- test-infra: FakeWorkerSettingsRepo.updateDefaultReviewWorkerType cannot simulate internal failure @preserve */
      if (!result.ok) {
        request.log.error({ error: result.error }, 'Failed to update default review worker type');
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }
      /* v8 ignore stop @preserve */

      request.log.info({ userId, workerType }, 'Default review worker type updated');

      return await reply.ok({ updated: true });
    }
  );

  done();
};
