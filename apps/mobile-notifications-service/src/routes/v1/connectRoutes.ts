/**
 * Connect routes for mobile-notifications-service.
 * POST /v1/mobile-notifications/connect - Create a new signature connection.
 */
import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { requireAuth } from '@intexuraos/common';
import { getServices } from '../../services.js';
import { createConnection } from '../../domain/notifications/index.js';
import { connectRequestSchema, connectResponseSchema } from './schemas.js';

interface ConnectBody {
  deviceLabel?: string;
}

export const connectRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post<{ Body: ConnectBody }>(
    '/v1/mobile-notifications/connect',
    {
      schema: {
        operationId: 'connectMobileNotifications',
        summary: 'Create signature connection',
        description:
          'Generate a new signature token for receiving mobile notifications. The plaintext signature is only returned once.',
        tags: ['mobile-notifications'],
        security: [{ bearerAuth: [] }],
        body: connectRequestSchema,
        response: {
          200: {
            description: 'Connection created successfully',
            type: 'object',
            required: ['success', 'data'],
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: connectResponseSchema,
            },
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            required: ['success', 'error'],
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
            },
          },
          500: {
            description: 'Internal error',
            type: 'object',
            required: ['success', 'error'],
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: ConnectBody }>, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { deviceLabel } = request.body;

      const createInput: { userId: string; deviceLabel?: string } = { userId: user.userId };
      if (deviceLabel !== undefined) {
        createInput.deviceLabel = deviceLabel;
      }

      const result = await createConnection(
        createInput,
        getServices().signatureConnectionRepository
      );

      if (!result.ok) {
        return await reply.fail(result.error.code, result.error.message);
      }

      return await reply.ok(result.value);
    }
  );

  done();
};
