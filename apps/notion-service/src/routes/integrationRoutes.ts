/**
 * Notion Integration Routes
 *
 * POST   /notion/connect    - Connect Notion integration
 * GET    /notion/status     - Get integration status
 * DELETE /notion/disconnect - Disconnect integration
 *
 * Routes are thin adapters - business logic lives in domain/integration/usecases.
 */

import type { FastifyPluginCallback } from 'fastify';
import { requireAuth } from '@intexuraos/common';
import { getServices } from '../services.js';
import {
  connectNotion,
  getNotionStatus,
  disconnectNotion,
  type ConnectNotionErrorCode,
} from '../domain/integration/index.js';

/**
 * Map domain error codes to HTTP error codes.
 */
function mapConnectErrorToHttp(
  code: ConnectNotionErrorCode
): 'INVALID_REQUEST' | 'UNAUTHORIZED' | 'DOWNSTREAM_ERROR' {
  switch (code) {
    case 'PAGE_NOT_ACCESSIBLE':
    case 'VALIDATION_ERROR':
      return 'INVALID_REQUEST';
    case 'INVALID_TOKEN':
      return 'UNAUTHORIZED';
    case 'DOWNSTREAM_ERROR':
      return 'DOWNSTREAM_ERROR';
  }
}

export const integrationRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // POST /notion/connect
  fastify.post(
    '/notion/connect',
    {
      schema: {
        operationId: 'connectNotion',
        summary: 'Connect Notion integration',
        description: 'Connect Notion integration for the authenticated user',
        tags: ['integrations'],
        security: [{ bearerAuth: [] }],
        body: { $ref: 'ConnectRequest#' },
        response: {
          200: {
            description: 'Connection successful',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: { $ref: 'ConnectResponse#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'data'],
          },
          400: {
            description: 'Invalid request',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          502: {
            description: 'Downstream error',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
        },
      },
    },
    async (request, reply) => {
      const user = await requireAuth(request, reply);
      if (user === null) return;

      // Fastify JSON schema validation ensures body is valid before handler runs
      const { notionToken, promptVaultPageId } = request.body as {
        notionToken: string;
        promptVaultPageId: string;
      };

      // Delegate to use-case
      const { connectionRepository, notionApi } = getServices();
      const result = await connectNotion(connectionRepository, notionApi, {
        userId: user.userId,
        notionToken,
        promptVaultPageId,
      });

      // Map result to HTTP response
      if (!result.ok) {
        return await reply.fail(
          mapConnectErrorToHttp(result.error.code),
          result.error.message,
          undefined,
          result.error.details
        );
      }

      return await reply.ok(result.value);
    }
  );

  // GET /notion/status
  fastify.get(
    '/notion/status',
    {
      schema: {
        operationId: 'getNotionStatus',
        summary: 'Get Notion integration status',
        description: 'Get Notion integration status for the authenticated user',
        tags: ['integrations'],
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            description: 'Status retrieved successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: { $ref: 'StatusResponse#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'data'],
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          502: {
            description: 'Downstream error',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
        },
      },
    },
    async (request, reply) => {
      const user = await requireAuth(request, reply);
      if (user === null) return;

      // Delegate to use-case
      const { connectionRepository } = getServices();
      const result = await getNotionStatus(connectionRepository, { userId: user.userId });

      // Map result to HTTP response
      if (!result.ok) {
        return await reply.fail('DOWNSTREAM_ERROR', result.error.message);
      }

      return await reply.ok(result.value);
    }
  );

  // DELETE /notion/disconnect
  fastify.delete(
    '/notion/disconnect',
    {
      schema: {
        operationId: 'disconnectNotion',
        summary: 'Disconnect Notion integration',
        description: 'Disconnect Notion integration for the authenticated user',
        tags: ['integrations'],
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            description: 'Disconnection successful',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: { $ref: 'DisconnectResponse#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'data'],
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          502: {
            description: 'Downstream error',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
        },
      },
    },
    async (request, reply) => {
      const user = await requireAuth(request, reply);
      if (user === null) return;

      // Delegate to use-case
      const { connectionRepository } = getServices();
      const result = await disconnectNotion(connectionRepository, { userId: user.userId });

      // Map result to HTTP response
      if (!result.ok) {
        return await reply.fail('DOWNSTREAM_ERROR', result.error.message);
      }

      return await reply.ok(result.value);
    }
  );

  done();
};
