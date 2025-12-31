/**
 * Prompt CRUD Routes
 *
 * GET   /prompt-vault/main-page            - Get main page with preview
 * GET   /prompt-vault/prompts              - List all prompts
 * POST  /prompt-vault/prompts              - Create a new prompt
 * GET   /prompt-vault/prompts/:prompt_id   - Get a single prompt
 * PATCH /prompt-vault/prompts/:prompt_id   - Update a prompt
 */

import type { FastifyPluginCallback } from 'fastify';
import { handleValidationError, requireAuth } from '@intexuraos/common-http';
import { createPrompt, getPrompt, listPrompts, updatePrompt } from '../domain/promptvault/index.js';
import { createPromptRequestSchema, updatePromptRequestSchema } from './schemas.js';
import { getServices } from '../services.js';
import { mapDomainErrorCode } from './shared.js';
import { getPageWithPreview } from '../infra/notion/index.js';

export const promptRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // GET /prompt-vault/main-page
  fastify.get(
    '/prompt-vault/main-page',
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

      const { notionServiceClient, promptVaultSettings } = getServices();

      // Get token and pageId in parallel
      const [tokenContextResult, pageIdResult] = await Promise.all([
        notionServiceClient.getNotionToken(user.userId),
        promptVaultSettings.getPromptVaultPageId(user.userId),
      ]);

      // Check token context
      if (!tokenContextResult.ok) {
        const errorCode =
          tokenContextResult.error.code === 'UNAUTHORIZED' ? 'UNAUTHORIZED' : 'DOWNSTREAM_ERROR';
        return await reply.fail(errorCode, tokenContextResult.error.message);
      }

      const { connected, token } = tokenContextResult.value;
      if (!connected || token === null) {
        return await reply.fail(
          'MISCONFIGURED',
          'Notion integration is not configured. Call POST /notion/connect first.'
        );
      }

      // Check promptVaultPageId
      if (!pageIdResult.ok) {
        return await reply.fail('DOWNSTREAM_ERROR', pageIdResult.error.message);
      }

      const promptVaultPageId = pageIdResult.value;
      if (promptVaultPageId === null) {
        return await reply.fail('MISCONFIGURED', 'PromptVault page ID not configured');
      }

      // Fetch page from Notion
      const pageResult = await getPageWithPreview(token, promptVaultPageId);
      if (!pageResult.ok) {
        return await reply.fail('DOWNSTREAM_ERROR', pageResult.error.message);
      }

      const pageData = pageResult.value;
      return await reply.ok({
        page: {
          id: pageData.id,
          title: pageData.title,
          url: pageData.url,
        },
        preview: {
          blocks: pageData.blocks,
        },
      });
    }
  );

  // GET /prompt-vault/prompts - List all prompts
  fastify.get(
    '/prompt-vault/prompts',
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

  // POST /prompt-vault/prompts - Create a new prompt
  fastify.post(
    '/prompt-vault/prompts',
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

  // GET /prompt-vault/prompts/:prompt_id - Get a single prompt
  fastify.get<{ Params: { prompt_id: string } }>(
    '/prompt-vault/prompts/:prompt_id',
    {
      schema: {
        operationId: 'getPrompt',
        summary: 'Get a prompt by ID',
        description: 'Get a single prompt from the PromptVault by its ID',
        tags: ['tools'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['prompt_id'],
          properties: {
            prompt_id: { type: 'string', description: 'Prompt ID' },
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

      const { prompt_id: promptId } = request.params;
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

  // PATCH /prompt-vault/prompts/:prompt_id - Update a prompt
  fastify.patch<{ Params: { prompt_id: string } }>(
    '/prompt-vault/prompts/:prompt_id',
    {
      schema: {
        operationId: 'updatePrompt',
        summary: 'Update a prompt',
        description: 'Update an existing prompt in the PromptVault',
        tags: ['tools'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['prompt_id'],
          properties: {
            prompt_id: { type: 'string', description: 'Prompt ID' },
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

      const { prompt_id: promptId } = request.params;

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
