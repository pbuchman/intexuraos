import type { FastifyPluginCallback, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { requireAuth } from '@praxos/common';
import { connectRequestSchema, createNoteRequestSchema, webhookRequestSchema } from './schemas.js';
import {
  setNotionConfig,
  getNotionConfig,
  removeNotionConfig,
  isNotionConfigured,
  getOrCreateNote,
} from '../stub/store.js';

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
  fastify.post('/v1/integrations/notion/connect', async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (user === null) return;

    const parseResult = connectRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      return await handleValidationError(parseResult.error, reply);
    }

    const { notionToken, promptVaultPageId } = parseResult.data;
    const config = setNotionConfig(user.userId, promptVaultPageId, notionToken);

    return await reply.ok({
      connected: config.connected,
      promptVaultPageId: config.promptVaultPageId,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    });
  });

  // GET /v1/integrations/notion/status
  fastify.get('/v1/integrations/notion/status', async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (user === null) return;

    const config = getNotionConfig(user.userId);

    return await reply.ok({
      configured: config !== null,
      connected: config?.connected ?? false,
      promptVaultPageId: config?.promptVaultPageId ?? null,
      createdAt: config?.createdAt ?? null,
      updatedAt: config?.updatedAt ?? null,
    });
  });

  // POST /v1/integrations/notion/disconnect
  fastify.post('/v1/integrations/notion/disconnect', async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (user === null) return;

    const config = removeNotionConfig(user.userId);

    return await reply.ok({
      connected: config.connected,
      promptVaultPageId: config.promptVaultPageId,
      updatedAt: config.updatedAt,
    });
  });

  // GET /v1/tools/notion/promptvault/main-page
  fastify.get('/v1/tools/notion/promptvault/main-page', async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (user === null) return;

    if (!isNotionConfigured(user.userId)) {
      return await reply.fail(
        'MISCONFIGURED',
        'Notion integration is not configured. Call POST /v1/integrations/notion/connect first.'
      );
    }

    const config = getNotionConfig(user.userId);

    // Stub response with deterministic data
    return await reply.ok({
      page: {
        id: config?.promptVaultPageId ?? 'stub-page-id',
        title: 'Prompt Vault',
        url: `https://notion.so/${config?.promptVaultPageId ?? 'stub-page-id'}`,
      },
      preview: {
        blocks: [
          {
            type: 'heading_1',
            content: 'Prompt Vault',
          },
          {
            type: 'paragraph',
            content: 'This is a stub preview of your Prompt Vault page.',
          },
          {
            type: 'bulleted_list_item',
            content: 'Item 1: System prompts',
          },
          {
            type: 'bulleted_list_item',
            content: 'Item 2: Templates',
          },
        ],
      },
    });
  });

  // POST /v1/tools/notion/note
  fastify.post('/v1/tools/notion/note', async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (user === null) return;

    if (!isNotionConfigured(user.userId)) {
      return await reply.fail(
        'MISCONFIGURED',
        'Notion integration is not configured. Call POST /v1/integrations/notion/connect first.'
      );
    }

    const parseResult = createNoteRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      return await handleValidationError(parseResult.error, reply);
    }

    const { title, idempotencyKey } = parseResult.data;
    const note = getOrCreateNote(user.userId, idempotencyKey, title);

    return await reply.ok({
      created: {
        id: note.id,
        url: note.url,
        title: note.title,
      },
    });
  });

  // POST /v1/webhooks/notion (no auth required)
  fastify.post('/v1/webhooks/notion', async (request, reply) => {
    const parseResult = webhookRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      return await handleValidationError(parseResult.error, reply);
    }

    // Stub: accept any JSON, no side effects
    return await reply.ok({
      received: true,
    });
  });

  done();
};
