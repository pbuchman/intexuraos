/**
 * Internal Routes for service-to-service communication.
 * GET /internal/notion/users/:userId/context - Get Notion connection context (token)
 */

import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { validateInternalAuth, logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../services.js';

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
      // Log incoming request BEFORE auth check (for debugging)
      logIncomingRequest(request, {
        message: 'Received request to /internal/notion/users/:userId/context',
        bodyPreviewLength: 200,
        includeParams: true,
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn(
          { reason: authResult.reason },
          'Internal auth failed for notion/users/:userId/context endpoint'
        );
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
