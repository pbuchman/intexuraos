/**
 * POST /internal/code/cancel-with-nonce route.
 *
 * Internal endpoint for canceling tasks via WhatsApp button callback.
 * Validates nonce, ownership, and expiration.
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import { type ErrorCode } from '@intexuraos/common-core';
import { getServices } from '../../services.js';
import { cancelTaskWithNonce } from '../../domain/usecases/cancelTaskWithNonce.js';

const cancelWithNonceRoute: FastifyPluginCallback = (fastify, _opts, done) => {
  // POST /internal/code/cancel-with-nonce - Cancel task via WhatsApp button (INT-379)
  fastify.post<{
    Body: {
      taskId: string;
      nonce: string;
      userId: string;
    };
  }>(
    '/internal/code/cancel-with-nonce',
    {
      schema: {
        operationId: 'cancelCodeTaskWithNonce',
        summary: 'Cancel a task using nonce validation',
        description: 'Internal endpoint for canceling tasks via WhatsApp button callback. Validates nonce, ownership, and expiration.',
        tags: ['internal'],
        body: {
          type: 'object',
          properties: {
            taskId: { type: 'string' },
            nonce: { type: 'string' },
            userId: { type: 'string' },
          },
          required: ['taskId', 'nonce', 'userId'],
        },
        response: {
          200: {
            description: 'Task cancelled successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  cancelled: { type: 'boolean', enum: [true] },
                },
                required: ['cancelled'],
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
                  code: { type: 'string', enum: ['UNAUTHORIZED'] },
                  message: { type: 'string' },
                },
                required: ['code', 'message'],
              },
            },
            required: ['success', 'error'],
          },
          400: {
            description: 'Bad request (invalid nonce, expired, or task not cancellable)',
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
          404: {
            description: 'Task not found',
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
    async (
      request: FastifyRequest<{
        Body: { taskId: string; nonce: string; userId: string };
      }>,
      reply: FastifyReply
    ) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /internal/code/cancel-with-nonce',
      });

      // Validate internal auth
      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Internal auth failed for cancel-with-nonce');
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      const services = getServices();
      const { taskId, nonce, userId } = request.body;

      request.log.info({ taskId, userId }, 'Processing cancel-with-nonce request');

      const result = await cancelTaskWithNonce(
        {
          logger: services.logger,
          codeTaskRepo: services.codeTaskRepo,
          taskDispatcher: services.taskDispatcher,
          workerSettingsRepo: services.workerSettingsRepo,
        },
        { taskId, nonce, userId }
      );

      if (!result.ok) {
        const error = result.error;
        request.log.warn({ taskId, errorCode: error.code, errorMessage: error.message }, 'Cancel-with-nonce failed');

        if (error.code === 'task_not_found') {
          return await reply.fail('NOT_FOUND', error.message);
        } else if (error.code === 'internal_error') {
          return await reply.fail('INTERNAL_ERROR', error.message);
        } else if (error.code === 'not_owner') {
          // NOT_OWNER returns 403 (not 400) as defined in ErrorCode mapping
          return await reply.fail('NOT_OWNER', error.message);
        } else {
          // Map domain-specific error codes to ErrorCode values
          const codeMap: Record<string, ErrorCode> = {
            invalid_nonce: 'INVALID_NONCE',
            nonce_expired: 'NONCE_EXPIRED',
            // not_owner NOT mapped here - it returns 403 and is handled above
            task_not_cancellable: 'TASK_NOT_CANCELLABLE',
          };
          const mappedCode = codeMap[error.code];
          /* v8 ignore start -- upstream: Domain guarantees all error codes are mapped, this is defensive @preserve */
          if (mappedCode === undefined) {
            // This should never happen - all domain error codes must be mapped
            request.log.error({ taskId, errorCode: error.code }, 'Unmapped domain error code in cancel-with-nonce');
            return await reply.fail('INTERNAL_ERROR', 'Unable to process error code');
          }
          /* v8 ignore stop @preserve */
          return await reply.fail(mappedCode, error.message);
        }
      }

      request.log.info({ taskId }, 'Task cancelled via nonce successfully');
      return await reply.ok({ cancelled: true });
    }
  );

  done();
};

export default cancelWithNonceRoute;
