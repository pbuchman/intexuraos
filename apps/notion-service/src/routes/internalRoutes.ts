/**
 * Internal Routes for service-to-service communication.
 * GET /internal/notion/users/:userId/context - Get Notion connection context (token)
 * GET /internal/notion/users/:userId/pages/:pageId/preview - Get Notion page preview
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

  // GET /internal/notion/users/:userId/pages/:pageId/preview
  fastify.get(
    '/internal/notion/users/:userId/pages/:pageId/preview',
    {
      schema: {
        operationId: 'getPagePreview',
        summary: 'Get Notion page preview for a user',
        description: 'Internal endpoint for validating Notion page access. Returns page title and URL.',
        tags: ['internal'],
        params: {
          type: 'object',
          required: ['userId', 'pageId'],
          properties: {
            userId: { type: 'string' },
            pageId: { type: 'string' },
          },
        },
        response: {
          200: {
            description: 'Page preview data',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  url: { type: 'string' },
                },
                required: ['title', 'url'],
              },
            },
            required: ['success', 'data'],
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { type: 'string' },
            },
            required: ['success', 'error'],
          },
          404: {
            description: 'Not found',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { type: 'string' },
            },
            required: ['success', 'error'],
          },
          502: {
            description: 'Downstream error',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { type: 'string' },
            },
            required: ['success', 'error'],
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to /internal/notion/users/:userId/pages/:pageId/preview',
        includeParams: true,
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn(
          { reason: authResult.reason },
          'Internal auth failed for page preview endpoint'
        );
        reply.status(401);
        return { success: false, error: 'Unauthorized' };
      }

      const { userId, pageId } = request.params as { userId: string; pageId: string };
      const { connectionRepository, notionApi } = getServices();

      // Get user's Notion connection
      const connectionResult = await connectionRepository.getConnection(userId);
      if (!connectionResult.ok) {
        reply.status(502);
        return { success: false, error: connectionResult.error.message };
      }
      if (connectionResult.value?.connected !== true) {
        reply.status(404);
        return { success: false, error: 'User has no active Notion connection' };
      }

      // Get token from connection
      const tokenResult = await connectionRepository.getToken(userId);
      if (!tokenResult.ok || tokenResult.value === null) {
        reply.status(404);
        return { success: false, error: 'User has no active Notion connection' };
      }

      // Fetch page preview from Notion
      const previewResult = await notionApi.getPageWithPreview(tokenResult.value, pageId);

      if (!previewResult.ok) {
        if (previewResult.error.code === 'NOT_FOUND') {
          reply.status(404);
          return { success: false, error: 'Page not found or not accessible' };
        }
        reply.status(502);
        return { success: false, error: previewResult.error.message };
      }

      return {
        success: true,
        data: {
          title: previewResult.value.page.title,
          url: previewResult.value.page.url,
        },
      };
    }
  );

  done();
};
