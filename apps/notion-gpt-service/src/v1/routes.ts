import type { FastifyPluginCallback, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { requireAuth } from '@praxos/common';
import {
  connectRequestSchema,
  createPromptRequestSchema,
  listPromptsQuerySchema,
  updatePromptRequestSchema,
  webhookRequestSchema,
} from './schemas.js';
import { getServices } from '../services.js';

/**
 * Handle Zod validation errors.
 */
function handleValidationError(error: ZodError, reply: FastifyReply): FastifyReply {
  const details = error.errors.map((e) => ({
    path: e.path.join('.'),
    message: e.message,
  }));
  return reply.fail('INVALID_REQUEST', 'Validation failed', undefined, {
    errors: details,
  });
}

/**
 * V1 routes plugin.
 * All protected endpoints use JWT validation via requireAuth from @praxos/common.
 * userId is derived from the JWT sub claim.
 */
export const v1Routes: FastifyPluginCallback = (fastify, _opts, done) => {
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
        response: {
          200: { description: 'Connection successful' },
          401: { description: 'Unauthorized' },
          502: { description: 'Downstream error' },
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
      const { connectionRepository } = getServices();

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
          200: { description: 'Status retrieved successfully' },
          401: { description: 'Unauthorized' },
          502: { description: 'Downstream error' },
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

  // POST /v1/integrations/notion/disconnect
  fastify.post(
    '/v1/integrations/notion/disconnect',
    {
      schema: {
        operationId: 'disconnectNotion',
        summary: 'Disconnect Notion integration',
        description: 'Disconnect Notion integration for the authenticated user',
        tags: ['integrations'],
        security: [{ bearerAuth: [] }],
        response: {
          200: { description: 'Disconnection successful' },
          401: { description: 'Unauthorized' },
          502: { description: 'Downstream error' },
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
          200: { description: 'Page retrieved successfully' },
          401: { description: 'Unauthorized' },
          502: { description: 'Downstream error' },
          503: { description: 'Service misconfigured' },
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

  // POST /v1/tools/notion/promptvault/prompts (create prompt)
  fastify.post(
    '/v1/tools/notion/promptvault/prompts',
    {
      schema: {
        operationId: 'createPrompt',
        summary: 'Create a new prompt',
        description: 'Create a new prompt in the PromptVault',
        tags: ['tools'],
        security: [{ bearerAuth: [] }],
        response: {
          200: { description: 'Prompt created successfully' },
          400: { description: 'Invalid request' },
          401: { description: 'Unauthorized' },
          502: { description: 'Downstream error' },
          503: { description: 'Service misconfigured' },
        },
      },
    },
    async (request, reply) => {
      const user = await requireAuth(request, reply);
      if (user === null) return;

      // Validate request body
      const parseResult = createPromptRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        return await handleValidationError(parseResult.error, reply);
      }

      const { title, prompt, tags, source } = parseResult.data;

      const { connectionRepository, createPromptUseCase } = getServices();

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

      // Create prompt
      const result = await createPromptUseCase.execute(user.userId, {
        title,
        prompt,
        tags: tags ?? undefined,
        source:
          source !== undefined
            ? { type: source.type, details: source.details ?? undefined }
            : undefined,
      });

      if (!result.ok) {
        return await reply.fail('DOWNSTREAM_ERROR', result.error.message);
      }

      const createdPrompt = result.value;

      return await reply.ok({
        id: createdPrompt.id,
        title: createdPrompt.title,
        preview: createdPrompt.preview,
        tags: createdPrompt.tags ?? null,
        source: createdPrompt.source ?? null,
        url: createdPrompt.url,
        createdAt: createdPrompt.createdAt,
        updatedAt: createdPrompt.updatedAt,
      });
    }
  );

  // GET /v1/tools/notion/promptvault/prompts (list prompts)
  fastify.get(
    '/v1/tools/notion/promptvault/prompts',
    {
      schema: {
        operationId: 'listPrompts',
        summary: 'List prompts',
        description: 'List all prompts in the PromptVault',
        tags: ['tools'],
        security: [{ bearerAuth: [] }],
        response: {
          200: { description: 'Prompts retrieved successfully' },
          401: { description: 'Unauthorized' },
          502: { description: 'Downstream error' },
          503: { description: 'Service misconfigured' },
        },
      },
    },
    async (request, reply) => {
      const user = await requireAuth(request, reply);
      if (user === null) return;

      // Validate query params
      const parseResult = listPromptsQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        return await handleValidationError(parseResult.error, reply);
      }

      const { limit, cursor, includeContent } = parseResult.data;

      const { connectionRepository, listPromptsUseCase } = getServices();

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

      // List prompts
      const result = await listPromptsUseCase.execute(user.userId, {
        limit: limit ?? undefined,
        cursor: cursor ?? undefined,
        includeContent: includeContent ?? undefined,
      });

      if (!result.ok) {
        return await reply.fail('DOWNSTREAM_ERROR', result.error.message);
      }

      const {prompts, hasMore, nextCursor } = result.value;

      return await reply.ok({
        prompts: prompts.map((p) => ({
          id: p.id,
          title: p.title,
          preview: p.preview,
          tags: p.tags ?? null,
          source: p.source ?? null,
          url: p.url,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          ...(includeContent === true && 'content' in p ? { content: p.content } : {}),
        })),
        hasMore,
        nextCursor: nextCursor ?? null,
      });
    }
  );

  // GET /v1/tools/notion/promptvault/prompts/:promptId (get single prompt)
  fastify.get(
    '/v1/tools/notion/promptvault/prompts/:promptId',
    {
      schema: {
        operationId: 'getPrompt',
        summary: 'Get a prompt by ID',
        description: 'Get a single prompt from the PromptVault',
        tags: ['tools'],
        security: [{ bearerAuth: [] }],
        response: {
          200: { description: 'Prompt retrieved successfully' },
          401: { description: 'Unauthorized' },
          404: { description: 'Prompt not found' },
          502: { description: 'Downstream error' },
          503: { description: 'Service misconfigured' },
        },
      },
    },
    async (request, reply) => {
      const user = await requireAuth(request, reply);
      if (user === null) return;

      const { promptId } = request.params as { promptId: string };

      const { connectionRepository, getPromptUseCase } = getServices();

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

      // Get prompt
      const result = await getPromptUseCase.execute(user.userId, promptId);

      if (!result.ok) {
        if (result.error.code === 'NOT_FOUND') {
          return await reply.status(404).fail('NOT_FOUND', result.error.message);
        }
        return await reply.fail('DOWNSTREAM_ERROR', result.error.message);
      }

      const prompt = result.value;

      return await reply.ok({
        id: prompt.id,
        title: prompt.title,
        content: prompt.content,
        preview: prompt.preview,
        tags: prompt.tags ?? null,
        source: prompt.source ?? null,
        url: prompt.url,
        createdAt: prompt.createdAt,
        updatedAt: prompt.updatedAt,
      });
    }
  );

  // PATCH /v1/tools/notion/promptvault/prompts/:promptId (update prompt)
  fastify.patch(
    '/v1/tools/notion/promptvault/prompts/:promptId',
    {
      schema: {
        operationId: 'updatePrompt',
        summary: 'Update a prompt',
        description: 'Update a prompt in the PromptVault (partial update)',
        tags: ['tools'],
        security: [{ bearerAuth: [] }],
        response: {
          200: { description: 'Prompt updated successfully' },
          400: { description: 'Invalid request' },
          401: { description: 'Unauthorized' },
          404: { description: 'Prompt not found' },
          502: { description: 'Downstream error' },
          503: { description: 'Service misconfigured' },
        },
      },
    },
    async (request, reply) => {
      const user = await requireAuth(request, reply);
      if (user === null) return;

      const { promptId } = request.params as { promptId: string };

      // Validate request body
      const parseResult = updatePromptRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        return await handleValidationError(parseResult.error, reply);
      }

      const { title, prompt, tags, source } = parseResult.data;

      const { connectionRepository, updatePromptUseCase } = getServices();

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

      // Update prompt
      const result = await updatePromptUseCase.execute(user.userId, promptId, {
        title: title ?? undefined,
        prompt: prompt ?? undefined,
        tags: tags ?? undefined,
        source:
          source !== undefined
            ? { type: source.type, details: source.details ?? undefined }
            : undefined,
      });

      if (!result.ok) {
        if (result.error.code === 'NOT_FOUND') {
          return await reply.status(404).fail('NOT_FOUND', result.error.message);
        }
        return await reply.fail('DOWNSTREAM_ERROR', result.error.message);
      }

      const updatedPrompt = result.value;

      return await reply.ok({
        id: updatedPrompt.id,
        title: updatedPrompt.title,
        content: updatedPrompt.content,
        preview: updatedPrompt.preview,
        tags: updatedPrompt.tags ?? null,
        source: updatedPrompt.source ?? null,
        url: updatedPrompt.url,
        createdAt: updatedPrompt.createdAt,
        updatedAt: updatedPrompt.updatedAt,
      });
    }
  );

  // POST /v1/webhooks/notion (no auth required)
  fastify.post(
    '/v1/webhooks/notion',
    {
      schema: {
        operationId: 'receiveNotionWebhook',
        summary: 'Receive Notion webhooks',
        description: 'Receive Notion webhooks (stub - accepts any JSON)',
        tags: ['webhooks'],
        response: {
          200: { description: 'Webhook received' },
          400: { description: 'Invalid request' },
        },
      },
    },
    async (request, reply) => {
      const parseResult = webhookRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        return await handleValidationError(parseResult.error, reply);
      }

      // Accept any JSON, no side effects for v1
      return await reply.ok({
        received: true,
      });
    }
  );

  done();
};
