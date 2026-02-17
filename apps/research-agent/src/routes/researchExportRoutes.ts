/**
 * Research Export Settings Routes
 *
 * GET  /research/settings/notion - Get research export Notion page ID
 * POST /research/settings/notion/validate - Validate a Notion page ID
 * POST /research/settings/notion - Save research export Notion page ID
 */

import type { FastifyPluginCallback } from 'fastify';
import type { Logger } from 'pino';
import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';

// Helper function for page ID format validation
function isValidNotionPageId(pageId: string): boolean {
  // 32 hex characters (no dashes)
  const hexOnly = /^[a-f0-9]{32}$/i;
  // UUID format with dashes
  const uuidFormat = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  return hexOnly.test(pageId) || uuidFormat.test(pageId);
}

// Normalize page ID by removing dashes
function normalizePageId(pageId: string): string {
  return pageId.replace(/-/g, '');
}

// Schemas for type coercion
const saveBodySchema = {
  type: 'object',
  properties: {
    researchPageId: { type: 'string' },
    researchPageTitle: { type: 'string' },
    researchPageUrl: { type: 'string' },
  },
} as const;

export const researchExportRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // POST /research/settings/notion/validate
  fastify.post('/research/settings/notion/validate', async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /research/settings/notion/validate',
      });

      const user = await requireAuth(request, reply);
      if (user === null) return;

      const { researchPageId } = request.body as { researchPageId: string };

      // Validate format
      if (!isValidNotionPageId(researchPageId)) {
        return await reply.fail(
          'INVALID_REQUEST',
          'Invalid page ID format. Expected 32 hex characters or UUID format.'
        );
      }

      // Normalize and fetch preview
      const normalizedPageId = normalizePageId(researchPageId);
      const { notionServiceClient } = getServices();

      const previewResult = await notionServiceClient.getPagePreview(
        user.userId,
        normalizedPageId,
        request.log as unknown as Logger
      );

      if (!previewResult.ok) {
        if (previewResult.error.code === 'NOT_FOUND') {
          return await reply.fail('NOT_FOUND', previewResult.error.message);
        }
        return await reply.fail('DOWNSTREAM_ERROR', previewResult.error.message);
      }

      return await reply.ok(previewResult.value);
    }
  );

  // GET /research/settings/notion
  fastify.get('/research/settings/notion', async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to GET /research/settings/notion',
      });

      const user = await requireAuth(request, reply);
      if (user === null) return;

      const { researchExportSettings } = getServices();
      const result = await researchExportSettings.getResearchSettings(user.userId);

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      if (result.value === null) {
        return await reply.ok({
          researchPageId: null,
          researchPageTitle: null,
          researchPageUrl: null,
        });
      }

      return await reply.ok({
        researchPageId: result.value.researchPageId,
        researchPageTitle: result.value.researchPageTitle,
        researchPageUrl: result.value.researchPageUrl,
      });
    }
  );

  // POST /research/settings/notion
  fastify.post(
    '/research/settings/notion',
    {
      schema: {
        body: saveBodySchema,
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /research/settings/notion',
      });

      const user = await requireAuth(request, reply);
      if (user === null) return;

      const { researchExportSettings } = getServices();
      const { researchPageId, researchPageTitle, researchPageUrl } = request.body as {
        researchPageId: string;
        researchPageTitle: string;
        researchPageUrl: string;
      };

      if (!researchPageId || typeof researchPageId !== 'string') {
        return await reply.fail('INVALID_REQUEST', 'researchPageId is required and must be a string');
      }

      const result = await researchExportSettings.saveResearchSettings(
        user.userId,
        researchPageId,
        researchPageTitle,
        researchPageUrl
      );

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok({
        researchPageId: result.value.researchPageId,
        researchPageTitle: result.value.researchPageTitle,
        researchPageUrl: result.value.researchPageUrl,
        createdAt: result.value.createdAt,
        updatedAt: result.value.updatedAt,
      });
    }
  );

  done();
};
