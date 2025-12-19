import type { FastifyPluginCallback, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { requireAuth } from '@praxos/common';
import {
  connectRequestSchema,
  createPromptVaultNoteRequestSchema,
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
        description: 'Connect Notion integration for the authenticated user',
        tags: ['integrations'],
        security: [{ bearerAuth: [] }],
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
        description: 'Get Notion integration status for the authenticated user',
        tags: ['integrations'],
        security: [{ bearerAuth: [] }],
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
        description: 'Disconnect Notion integration for the authenticated user',
        tags: ['integrations'],
        security: [{ bearerAuth: [] }],
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
        description: 'Get the main PromptVault page from Notion',
        tags: ['tools'],
        security: [{ bearerAuth: [] }],
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

  // POST /v1/tools/notion/promptvault/note
  fastify.post(
    '/v1/tools/notion/promptvault/note',
    {
      schema: {
        description: 'Create a new note in the PromptVault',
        tags: ['tools'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const user = await requireAuth(request, reply);
      if (user === null) return;

      // Validate request body first (before checking connection)
      const parseResult = createPromptVaultNoteRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        return await handleValidationError(parseResult.error, reply);
      }

      const { title, prompt } = parseResult.data;

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

      const parentPageId = config.promptVaultPageId;

      // Create PromptVault note in Notion with exact block structure
      const createResult = await notionApi.createPromptVaultNote({
        token,
        parentPageId,
        title,
        prompt,
        userId: user.userId,
      });

      if (!createResult.ok) {
        return await reply.fail('DOWNSTREAM_ERROR', createResult.error.message);
      }

      const createdNote = createResult.value;

      return await reply.ok({
        pageId: createdNote.id,
        url: createdNote.url,
        title: createdNote.title,
      });
    }
  );

  // POST /v1/webhooks/notion (no auth required)
  fastify.post(
    '/v1/webhooks/notion',
    {
      schema: {
        description: 'Receive Notion webhooks',
        tags: ['webhooks'],
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
