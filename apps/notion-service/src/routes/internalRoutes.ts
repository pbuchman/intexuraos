/**
 * Internal Routes for service-to-service communication.
 * GET /internal/notion/users/:userId/context - Get Notion connection context (token)
 */

import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { getServices } from '../services.js';

/**
 * Validate internal service-to-service authentication.
 * Reads INTEXURAOS_INTERNAL_AUTH_TOKEN at runtime to support test injection.
 */
function validateInternalAuth(request: FastifyRequest): boolean {
  const internalAuthToken = process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '';
  if (internalAuthToken === '') {
    request.log.warn('Internal auth failed: INTEXURAOS_INTERNAL_AUTH_TOKEN not configured');
    return false;
  }
  const authHeader = request.headers['x-internal-auth'];
  if (authHeader !== internalAuthToken) {
    request.log.warn('Internal auth failed: token mismatch');
    return false;
  }
  return true;
}

export const internalRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // GET /internal/notion/users/:userId/context
  fastify.get(
    '/internal/notion/users/:userId/context',
    {
      schema: {
        operationId: 'getInternalNotionContext',
        summary: 'Get Notion connection context (internal)',
        description:
          'Internal endpoint for service-to-service communication. Returns connection state and token.',
        tags: ['internal'],
        params: {
          type: 'object',
          properties: {
            userId: { type: 'string', description: 'User ID' },
          },
          required: ['userId'],
        },
        response: {
          200: {
            description: 'Notion connection context',
            type: 'object',
            properties: {
              connected: { type: 'boolean' },
              token: { type: 'string', nullable: true },
            },
            required: ['connected', 'token'],
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!validateInternalAuth(request)) {
        reply.status(401);
        return { error: 'Unauthorized' };
      }

      const params = request.params as { userId: string };
      const { connectionRepository } = getServices();

      // Check if connected
      const connectedResult = await connectionRepository.isConnected(params.userId);
      if (!connectedResult.ok) {
        return {
          connected: false,
          token: null,
        };
      }

      if (!connectedResult.value) {
        return {
          connected: false,
          token: null,
        };
      }

      // Get token
      const tokenResult = await connectionRepository.getToken(params.userId);
      const token = tokenResult.ok ? tokenResult.value : null;

      return {
        connected: true,
        token,
      };
    }
  );

  done();
};
