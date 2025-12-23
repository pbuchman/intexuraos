/**
 * Prompt CRUD Routes
 *
 * GET   /v1/tools/notion/promptvault/main-page          - Get main page with preview
 * GET   /v1/tools/notion/promptvault/prompts            - List all prompts
 * POST  /v1/tools/notion/promptvault/prompts            - Create a new prompt
 * GET   /v1/tools/notion/promptvault/prompts/:promptId  - Get a single prompt
 * PATCH /v1/tools/notion/promptvault/prompts/:promptId  - Update a prompt
 */

import type { FastifyPluginCallback } from 'fastify';
import { requireAuth } from '@praxos/common';
import {
  createPrompt,
  listPrompts,
  getPrompt,
  updatePrompt,
} from '../../domain/promptvault/index.js';
import { createPromptRequestSchema, updatePromptRequestSchema } from './schemas.js';
import { getServices } from '../../services.js';
import { handleValidationError, mapDomainErrorCode } from './shared.js';

export const promptRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // GET /v1/tools/notion/promptvault/main-page
  fastify.get(
    '/v1/tools/notion/promptvault/main-page',
    {
      schema: {
        operationId: 'getPromptVaultMainPage',
        summary: 'Get PromptVault main page',
        description: 'Get the main PromptVault page from Notion',
        tags: ['tools'],
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            description: 'Page retrieved successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: { $ref: 'MainPageResponse#' },
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
          503: {
            description: 'Service misconfigured',
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

      const { connectionRepository, notionApi } = getServices();

      // Check if connected
      const connectedResult = await connectionRepository.isConnected(user.userId);
      if (!connectedResult.ok) {
        return await reply.fail('DOWNSTREAM_ERROR', connectedResult.error.message);
      }

      const isConnected = connectedResult.value;
      if (!isConnected) {
        return await reply.fail(
          'MISCONFIGURED',
          'Notion integration is not configured. Call POST /v1/integrations/notion/connect first.'
        );
      }

      // Get token
      const tokenResult = await connectionRepository.getToken(user.userId);
      if (!tokenResult.ok) {
        return await reply.fail('DOWNSTREAM_ERROR', tokenResult.error.message);
      }
      const token = tokenResult.value;
      if (token === null) {
        return await reply.fail('MISCONFIGURED', 'Notion token not found.');
      }

      // Get config
      const configResult = await connectionRepository.getConnection(user.userId);
      if (!configResult.ok) {
        return await reply.fail('DOWNSTREAM_ERROR', configResult.error.message);
      }
      const config = configResult.value;
      if (config === null) {
        return await reply.fail('MISCONFIGURED', 'Notion configuration not found.');
      }

      const pageId = config.promptVaultPageId;

      // Fetch page from Notion
      const pageResult = await notionApi.getPageWithPreview(token, pageId);
      if (!pageResult.ok) {
        return await reply.fail('DOWNSTREAM_ERROR', pageResult.error.message);
      }

      const pageData = pageResult.value;
      return await reply.ok({
        page: pageData.page,
        preview: {
          blocks: pageData.blocks,
        },
      });
    }
  );

  // GET /v1/tools/notion/promptvault/prompts - List all prompts
  fastify.get(
    '/v1/tools/notion/promptvault/prompts',
    {
      schema: {
        operationId: 'listPrompts',
        summary: 'List all prompts',
        description: 'List all prompts in the PromptVault',
        tags: ['tools'],
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            description: 'Prompts retrieved successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: { $ref: 'PromptsListResponse#' },
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
          503: {
            description: 'Service misconfigured',
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

      const { promptRepository } = getServices();

      const result = await listPrompts(promptRepository, { userId: user.userId });

      if (!result.ok) {
        return await reply.fail(mapDomainErrorCode(result.error.code), result.error.message);
      }

      return await reply.ok({
        prompts: result.value.map((p) => ({
          id: p.id,
          title: p.title,
          prompt: p.content,
          url: p.url,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
        })),
      });
    }
  );

  // POST /v1/tools/notion/promptvault/prompts - Create a new prompt
  fastify.post(
    '/v1/tools/notion/promptvault/prompts',
    {
      schema: {
        operationId: 'createPrompt',
        summary: 'Create a new prompt',
        description: 'Create a new prompt in the PromptVault',
        tags: ['tools'],
        security: [{ bearerAuth: [] }],
        body: { $ref: 'CreatePromptRequest#' },
        response: {
          200: {
            description: 'Prompt created successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: { $ref: 'PromptResponse#' },
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
          503: {
            description: 'Service misconfigured',
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

      const parseResult = createPromptRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        return await handleValidationError(parseResult.error, reply);
      }

      const { title, prompt: promptContent } = parseResult.data;
      const { promptRepository } = getServices();

      const result = await createPrompt(promptRepository, {
        userId: user.userId,
        title,
        content: promptContent,
      });

      if (!result.ok) {
        return await reply.fail(mapDomainErrorCode(result.error.code), result.error.message);
      }

      return await reply.ok({
        prompt: {
          id: result.value.id,
          title: result.value.title,
          prompt: result.value.content,
          url: result.value.url,
          createdAt: result.value.createdAt,
          updatedAt: result.value.updatedAt,
        },
      });
    }
  );

  // GET /v1/tools/notion/promptvault/prompts/:promptId - Get a single prompt
  fastify.get<{ Params: { promptId: string } }>(
    '/v1/tools/notion/promptvault/prompts/:promptId',
    {
      schema: {
        operationId: 'getPrompt',
        summary: 'Get a prompt by ID',
        description: 'Get a single prompt from the PromptVault by its ID',
        tags: ['tools'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['promptId'],
          properties: {
            promptId: { type: 'string', description: 'Prompt ID' },
          },
        },
        response: {
          200: {
            description: 'Prompt retrieved successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: { $ref: 'PromptResponse#' },
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
          404: {
            description: 'Prompt not found',
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
          503: {
            description: 'Service misconfigured',
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

      const { promptId } = request.params;
      const { promptRepository } = getServices();

      const result = await getPrompt(promptRepository, {
        userId: user.userId,
        promptId,
      });

      if (!result.ok) {
        return await reply.fail(mapDomainErrorCode(result.error.code), result.error.message);
      }

      return await reply.ok({
        prompt: {
          id: result.value.id,
          title: result.value.title,
          prompt: result.value.content,
          url: result.value.url,
          createdAt: result.value.createdAt,
          updatedAt: result.value.updatedAt,
        },
      });
    }
  );

  // PATCH /v1/tools/notion/promptvault/prompts/:promptId - Update a prompt
  fastify.patch<{ Params: { promptId: string } }>(
    '/v1/tools/notion/promptvault/prompts/:promptId',
    {
      schema: {
        operationId: 'updatePrompt',
        summary: 'Update a prompt',
        description: 'Update an existing prompt in the PromptVault',
        tags: ['tools'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['promptId'],
          properties: {
            promptId: { type: 'string', description: 'Prompt ID' },
          },
        },
        body: { $ref: 'UpdatePromptRequest#' },
        response: {
          200: {
            description: 'Prompt updated successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: { $ref: 'PromptResponse#' },
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
          404: {
            description: 'Prompt not found',
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
          503: {
            description: 'Service misconfigured',
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

      const { promptId } = request.params;

      const parseResult = updatePromptRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        return await handleValidationError(parseResult.error, reply);
      }

      const { title, prompt: promptContent } = parseResult.data;
      const { promptRepository } = getServices();

      const result = await updatePrompt(promptRepository, {
        userId: user.userId,
        promptId,
        title,
        content: promptContent,
      });

      if (!result.ok) {
        return await reply.fail(mapDomainErrorCode(result.error.code), result.error.message);
      }

      return await reply.ok({
        prompt: {
          id: result.value.id,
          title: result.value.title,
          prompt: result.value.content,
          url: result.value.url,
          createdAt: result.value.createdAt,
          updatedAt: result.value.updatedAt,
        },
      });
    }
  );

  done();
};
