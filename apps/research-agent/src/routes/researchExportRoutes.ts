/**
 * Research Export Settings Routes
 *
 * GET  /research/settings/notion - Get research export Notion page ID
 * POST /research/settings/notion - Save research export Notion page ID
 */

import type { FastifyPluginCallback } from 'fastify';
import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';

// Response schemas following the pattern from researchSchemas.ts
const getResearchExportSettingsResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    data: {
      type: 'object',
      properties: {
        researchPageId: { type: 'string', nullable: true },
      },
    },
    diagnostics: {
      type: 'object',
      properties: {
        requestId: { type: 'string' },
        durationMs: { type: 'number' },
      },
    },
  },
} as const;

const saveResearchExportSettingsResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    data: {
      type: 'object',
      properties: {
        researchPageId: { type: 'string' },
        createdAt: { type: 'string' },
        updatedAt: { type: 'string' },
      },
    },
    diagnostics: {
      type: 'object',
      properties: {
        requestId: { type: 'string' },
        durationMs: { type: 'number' },
      },
    },
  },
} as const;

export const researchExportRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // GET /research/settings/notion
  fastify.get(
    '/research/settings/notion',
    {
      schema: {
        operationId: 'getResearchExportSettings',
        summary: 'Get research export Notion page ID',
        description: 'Get the configured Notion page ID for research export.',
        tags: ['research'],
        response: {
          200: getResearchExportSettingsResponseSchema,
        },
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to GET /research/settings/notion',
      });

      const user = await requireAuth(request, reply);
      if (user === null) return;

      const { researchExportSettings } = getServices();
      const result = await researchExportSettings.getResearchPageId(user.userId);

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok({
        researchPageId: result.value,
      });
    }
  );

  // POST /research/settings/notion
  fastify.post(
    '/research/settings/notion',
    {
      schema: {
        operationId: 'saveResearchExportSettings',
        summary: 'Save research export Notion page ID',
        description: 'Save the Notion page ID for research export.',
        tags: ['research'],
        body: {
          type: 'object',
          required: ['researchPageId'],
          properties: {
            researchPageId: { type: 'string' },
          },
          additionalProperties: false,
        },
        response: {
          200: saveResearchExportSettingsResponseSchema,
        },
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /research/settings/notion',
      });

      const user = await requireAuth(request, reply);
      if (user === null) return;

      const { researchExportSettings } = getServices();
      const { researchPageId } = request.body as { researchPageId: string };

      if (!researchPageId || typeof researchPageId !== 'string') {
        return await reply.fail('INVALID_REQUEST', 'researchPageId is required and must be a string');
      }

      const result = await researchExportSettings.saveResearchPageId(user.userId, researchPageId);

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok({
        researchPageId: result.value.researchPageId,
        createdAt: result.value.createdAt,
        updatedAt: result.value.updatedAt,
      });
    }
  );

  done();
};
