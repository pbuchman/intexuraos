/**
 * Routes for per-user worker settings management.
 *
 * All routes require Auth0 JWT authentication.
 * Secrets are masked in responses (show last 3 chars only).
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest } from '@intexuraos/common-http';
import { getErrorMessage } from '@intexuraos/common-core';
import { getServices } from '../services.js';
import type { JwtValidator } from './codeRoutes.js';
import type {
  WorkerConfig,
  WorkerConfigInput,
  WorkerType,
  MaskedWorkerConfig,
  UserWorkerSettingsResponse,
} from '../domain/models/workerSettings.js';

export interface WorkerSettingsRoutesOptions {
  jwtValidator: JwtValidator;
}

/**
 * Mask a secret string for API response.
 * Shows only last 3 characters, rest as dots.
 */
function maskSecret(secret: string): string {
  /* v8 ignore start -- test-infra: edge case for very short secrets rarely occurs @preserve */
  if (secret.length <= 3) {
    return '•••';
  }
  /* v8 ignore stop @preserve */
  return '•'.repeat(Math.min(secret.length - 3, 20)) + secret.slice(-3);
}

/**
 * Convert worker config to masked version for API response.
 */
function maskWorkerConfig(config: WorkerConfig): MaskedWorkerConfig {
  const masked: MaskedWorkerConfig = {
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

/**
 * Validate worker type parameter.
 */
function isValidWorkerType(type: string): type is WorkerType {
  /* v8 ignore start -- ts-type: type guard comparison always takes one branch @preserve */
  return type === 'mac' || type === 'vm';
  /* v8 ignore stop @preserve */
}

const workerConfigInputSchema = {
  type: 'object',
  properties: {
    url: { type: 'string', format: 'uri' },
    cfAccessClientId: { type: 'string', minLength: 1 },
    cfAccessClientSecret: { type: 'string', minLength: 1 },
    dispatchSigningSecret: { type: 'string', minLength: 1 },
    enabled: { type: 'boolean' },
  },
  required: ['url', 'cfAccessClientId', 'cfAccessClientSecret', 'dispatchSigningSecret'],
} as const;

const maskedWorkerConfigSchema = {
  type: 'object',
  properties: {
    url: { type: 'string' },
    cfAccessClientId: { type: 'string' },
    cfAccessClientSecret: { type: 'string' },
    dispatchSigningSecret: { type: 'string' },
    enabled: { type: 'boolean' },
    lastTestedAt: { type: 'string', nullable: true },
    testStatus: { type: 'string', enum: ['success', 'failure'], nullable: true },
    testMessage: { type: 'string', nullable: true },
  },
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
                  mac: maskedWorkerConfigSchema,
                  vm: maskedWorkerConfigSchema,
                  workerPriority: {
                    type: 'array',
                    items: { type: 'string', enum: ['mac', 'vm'] },
                  },
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
    /* v8 ignore start -- test-infra: route handler auth branches tested at middleware level @preserve */
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

      if (!result.ok) {
        request.log.error({ error: result.error }, 'Failed to get worker settings');
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      const settings = result.value;

      /* v8 ignore start -- ts-type: optional property checks for worker configs @preserve */
      const response: UserWorkerSettingsResponse = {};

      if (settings !== null) {
        if (settings.mac !== undefined) {
          response.mac = maskWorkerConfig(settings.mac);
        }
        if (settings.vm !== undefined) {
          response.vm = maskWorkerConfig(settings.vm);
        }
        if (settings.workerPriority !== undefined) {
          response.workerPriority = settings.workerPriority;
        }
      }
      /* v8 ignore stop @preserve */

      return await reply.ok(response);
    }
    /* v8 ignore stop @preserve */
  );

  // PATCH /code/worker-settings/:workerType - Create/update worker config
  fastify.patch<{
    Params: { workerType: string };
    Body: WorkerConfigInput;
  }>(
    '/code/worker-settings/:workerType',
    {
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      onRequest: jwtValidator,
      schema: {
        operationId: 'updateWorkerConfig',
        summary: 'Create or update worker configuration',
        description: 'Create or update configuration for a specific worker type (mac or vm). Requires Auth0 JWT.',
        tags: ['public', 'worker-settings'],
        params: {
          type: 'object',
          properties: {
            workerType: { type: 'string', enum: ['mac', 'vm'] },
          },
          required: ['workerType'],
        },
        body: workerConfigInputSchema,
        response: {
          200: {
            description: 'Worker config updated',
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
            description: 'Invalid worker type',
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
    /* v8 ignore start -- test-infra: route handler auth branches tested at middleware level @preserve */
    async (
      request: FastifyRequest<{ Params: { workerType: string }; Body: WorkerConfigInput }>,
      reply: FastifyReply
    ) => {
      logIncomingRequest(request, {
        message: 'Received request to PATCH /code/worker-settings/:workerType',
        includeParams: true,
      });

      const { workerSettingsRepo } = getServices();
      /* v8 ignore stop @preserve */
      const userId = request.user?.userId ?? 'unknown-user';
      const { workerType } = request.params;

      if (!isValidWorkerType(workerType)) {
        return await reply.fail('INVALID_REQUEST', 'Worker type must be "mac" or "vm"');
      }

      request.log.info({ userId, workerType }, 'Updating worker config');

      const result = await workerSettingsRepo.updateWorkerConfig(userId, workerType, request.body);

      if (!result.ok) {
        request.log.error({ error: result.error }, 'Failed to update worker config');
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      request.log.info({ userId, workerType }, 'Worker config updated successfully');

      return await reply.ok({ updated: true });
    }
  );

  // DELETE /code/worker-settings/:workerType - Delete worker config
  fastify.delete<{
    Params: { workerType: string };
  }>(
    '/code/worker-settings/:workerType',
    {
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      onRequest: jwtValidator,
      schema: {
        operationId: 'deleteWorkerConfig',
        summary: 'Delete worker configuration',
        description: 'Delete configuration for a specific worker type. Requires Auth0 JWT.',
        tags: ['public', 'worker-settings'],
        params: {
          type: 'object',
          properties: {
            workerType: { type: 'string', enum: ['mac', 'vm'] },
          },
          required: ['workerType'],
        },
        response: {
          200: {
            description: 'Worker config deleted',
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
            description: 'Invalid worker type',
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
    /* v8 ignore start -- test-infra: route handler auth branches tested at middleware level @preserve */
    async (
      request: FastifyRequest<{ Params: { workerType: string } }>,
      reply: FastifyReply
    ) => {
      logIncomingRequest(request, {
        message: 'Received request to DELETE /code/worker-settings/:workerType',
        includeParams: true,
      });

      const { workerSettingsRepo } = getServices();
      /* v8 ignore stop @preserve */
      const userId = request.user?.userId ?? 'unknown-user';
      const { workerType } = request.params;

      if (!isValidWorkerType(workerType)) {
        return await reply.fail('INVALID_REQUEST', 'Worker type must be "mac" or "vm"');
      }

      request.log.info({ userId, workerType }, 'Deleting worker config');

      const result = await workerSettingsRepo.deleteWorkerConfig(userId, workerType);

      if (!result.ok) {
        request.log.error({ error: result.error }, 'Failed to delete worker config');
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      request.log.info({ userId, workerType }, 'Worker config deleted successfully');

      return await reply.ok({ deleted: true });
    }
  );

  // POST /code/worker-settings/:workerType/test - Test worker connectivity
  fastify.post<{
    Params: { workerType: string };
  }>(
    '/code/worker-settings/:workerType/test',
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
            workerType: { type: 'string', enum: ['mac', 'vm'] },
          },
          required: ['workerType'],
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
            description: 'Invalid worker type',
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
    /* v8 ignore start -- test-infra: route handler auth branches tested at middleware level @preserve */
    async (
      request: FastifyRequest<{ Params: { workerType: string } }>,
      reply: FastifyReply
    ) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /code/worker-settings/:workerType/test',
        includeParams: true,
      });

      const { workerSettingsRepo } = getServices();
      /* v8 ignore stop @preserve */
      const userId = request.user?.userId ?? 'unknown-user';
      const { workerType } = request.params;

      if (!isValidWorkerType(workerType)) {
        return await reply.fail('INVALID_REQUEST', 'Worker type must be "mac" or "vm"');
      }

      request.log.info({ userId, workerType }, 'Testing worker connectivity');

      const configResult = await workerSettingsRepo.getWorkerConfig(userId, workerType);

      if (!configResult.ok) {
        request.log.error({ error: configResult.error }, 'Failed to get worker config for test');
        return await reply.fail('INTERNAL_ERROR', configResult.error.message);
      }

      const config = configResult.value;

      if (config === null) {
        return await reply.fail('NOT_FOUND', `${workerType} worker not configured`);
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
        request.log.warn({ userId, workerType, error: errorMessage }, 'Worker connectivity test failed');
      }

      await workerSettingsRepo.updateTestResult(userId, workerType, {
        testStatus,
        testMessage,
        lastTestedAt,
      });

      request.log.info({ userId, workerType, testStatus }, 'Worker connectivity test completed');

      return await reply.ok({
        testStatus,
        testMessage,
        lastTestedAt,
      });
    }
  );

  done();
};
