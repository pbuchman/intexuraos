/**
 * Notion Integration Routes
 *
 * POST   /v1/integrations/notion/connect    - Connect Notion integration
 * GET    /v1/integrations/notion/status     - Get integration status
 * DELETE /v1/integrations/notion/disconnect - Disconnect integration
 */

import type { FastifyPluginCallback } from 'fastify';
import { requireAuth } from '@praxos/common';
import { connectRequestSchema } from './schemas.js';
import { getServices } from '../../services.js';
import { handleValidationError } from './shared.js';

export const integrationRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // POST /v1/integrations/notion/connect
  fastify.post(
    '/v1/integrations/notion/connect',
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

      const parseResult = connectRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        return await handleValidationError(parseResult.error, reply);
      }

      const { notionToken, promptVaultPageId } = parseResult.data;
      const { connectionRepository, notionApi } = getServices();

      // Validate page access BEFORE saving connection
      const pageValidation = await notionApi.getPageWithPreview(notionToken, promptVaultPageId);
      if (!pageValidation.ok) {
        const errorCode = pageValidation.error.code;
        if (errorCode === 'NOT_FOUND') {
          return await reply.fail(
            'INVALID_REQUEST',
            `Could not access page with ID "${promptVaultPageId}". ` +
              'Make sure the page exists and is shared with your Notion integration. ' +
              'You can share a page by clicking "..." menu → "Add connections" → select your integration.',
            undefined,
            { pageId: promptVaultPageId, notionError: pageValidation.error.message }
          );
        }
        if (errorCode === 'UNAUTHORIZED') {
          return await reply.fail(
            'UNAUTHORIZED',
            'Invalid Notion token. Please reconnect your Notion integration.',
            undefined,
            { notionError: pageValidation.error.message }
          );
        }
        return await reply.fail('DOWNSTREAM_ERROR', pageValidation.error.message, undefined, {
          notionError: pageValidation.error.code,
        });
      }

      // Page is accessible - save the connection
      const result = await connectionRepository.saveConnection(
        user.userId,
        promptVaultPageId,
        notionToken
      );

      if (!result.ok) {
        return await reply.fail('DOWNSTREAM_ERROR', result.error.message);
      }

      const config = result.value;
      return await reply.ok({
        connected: config.connected,
        promptVaultPageId: config.promptVaultPageId,
        createdAt: config.createdAt,
        updatedAt: config.updatedAt,
        pageTitle: pageValidation.value.page.title,
        pageUrl: pageValidation.value.page.url,
      });
    }
  );

  // GET /v1/integrations/notion/status
  fastify.get(
    '/v1/integrations/notion/status',
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

      const { connectionRepository } = getServices();
      const result = await connectionRepository.getConnection(user.userId);

      if (!result.ok) {
        return await reply.fail('DOWNSTREAM_ERROR', result.error.message);
      }

      const config = result.value;
      return await reply.ok({
        configured: config !== null,
        connected: config?.connected ?? false,
        promptVaultPageId: config?.promptVaultPageId ?? null,
        createdAt: config?.createdAt ?? null,
        updatedAt: config?.updatedAt ?? null,
      });
    }
  );

  // DELETE /v1/integrations/notion/disconnect
  fastify.delete(
    '/v1/integrations/notion/disconnect',
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

      const { connectionRepository } = getServices();
      const result = await connectionRepository.disconnectConnection(user.userId);

      if (!result.ok) {
        return await reply.fail('DOWNSTREAM_ERROR', result.error.message);
      }

      const config = result.value;
      return await reply.ok({
        connected: config.connected,
        promptVaultPageId: config.promptVaultPageId,
        updatedAt: config.updatedAt,
      });
    }
  );

  done();
};
