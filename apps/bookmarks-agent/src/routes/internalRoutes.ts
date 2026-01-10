import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { validateInternalAuth, logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { createBookmark } from '../domain/usecases/createBookmark.js';
import { getBookmark } from '../domain/usecases/getBookmark.js';
import { updateBookmarkInternal } from '../domain/usecases/updateBookmarkInternal.js';
import type { Bookmark, BookmarkStatus, OgFetchStatus, OpenGraphPreview } from '../domain/models/bookmark.js';

interface CreateBookmarkBody {
  userId: string;
  url: string;
  title?: string;
  description?: string;
  tags?: string[];
  status?: BookmarkStatus;
  source: string;
  sourceId: string;
}

interface UpdateBookmarkBody {
  title?: string;
  description?: string;
  tags?: string[];
  archived?: boolean;
  aiSummary?: string;
  ogPreview?: OpenGraphPreview;
  ogFetchStatus?: OgFetchStatus;
}

interface BookmarkParams {
  id: string;
}

interface GetBookmarkQuery {
  userId: string;
}

const ogFetchStatusEnum = ['pending', 'processed', 'failed'];
const bookmarkStatusEnum = ['draft', 'active'];

const createBookmarkBodySchema = {
  type: 'object',
  required: ['userId', 'url', 'source', 'sourceId'],
  properties: {
    userId: { type: 'string', minLength: 1 },
    url: { type: 'string', format: 'uri' },
    title: { type: 'string' },
    description: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    status: { type: 'string', enum: bookmarkStatusEnum },
    source: { type: 'string', minLength: 1 },
    sourceId: { type: 'string', minLength: 1 },
  },
} as const;

const updateBookmarkBodySchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    archived: { type: 'boolean' },
    aiSummary: { type: 'string' },
    ogPreview: {
      type: 'object',
      properties: {
        title: { type: ['string', 'null'] },
        description: { type: ['string', 'null'] },
        image: { type: ['string', 'null'] },
        siteName: { type: ['string', 'null'] },
        type: { type: ['string', 'null'] },
        favicon: { type: ['string', 'null'] },
      },
    },
    ogFetchStatus: { type: 'string', enum: ogFetchStatusEnum },
  },
} as const;

const bookmarkParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string' },
  },
} as const;

const getBookmarkQuerySchema = {
  type: 'object',
  required: ['userId'],
  properties: {
    userId: { type: 'string', minLength: 1 },
  },
} as const;

const openGraphPreviewSchema = {
  type: ['object', 'null'],
  properties: {
    title: { type: ['string', 'null'] },
    description: { type: ['string', 'null'] },
    image: { type: ['string', 'null'] },
    siteName: { type: ['string', 'null'] },
    type: { type: ['string', 'null'] },
    favicon: { type: ['string', 'null'] },
  },
} as const;

const bookmarkResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    userId: { type: 'string' },
    status: { type: 'string', enum: bookmarkStatusEnum },
    url: { type: 'string' },
    title: { type: ['string', 'null'] },
    description: { type: ['string', 'null'] },
    tags: { type: 'array', items: { type: 'string' } },
    ogPreview: openGraphPreviewSchema,
    ogFetchedAt: { type: ['string', 'null'], format: 'date-time' },
    ogFetchStatus: { type: 'string', enum: ogFetchStatusEnum },
    aiSummary: { type: ['string', 'null'] },
    aiSummarizedAt: { type: ['string', 'null'], format: 'date-time' },
    source: { type: 'string' },
    sourceId: { type: 'string' },
    archived: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

function formatBookmark(bookmark: Bookmark): object {
  return {
    id: bookmark.id,
    userId: bookmark.userId,
    status: bookmark.status,
    url: bookmark.url,
    title: bookmark.title,
    description: bookmark.description,
    tags: bookmark.tags,
    ogPreview: bookmark.ogPreview,
    ogFetchedAt: bookmark.ogFetchedAt !== null ? bookmark.ogFetchedAt.toISOString() : null,
    ogFetchStatus: bookmark.ogFetchStatus,
    aiSummary: bookmark.aiSummary,
    aiSummarizedAt: bookmark.aiSummarizedAt !== null ? bookmark.aiSummarizedAt.toISOString() : null,
    source: bookmark.source,
    sourceId: bookmark.sourceId,
    archived: bookmark.archived,
    createdAt: bookmark.createdAt.toISOString(),
    updatedAt: bookmark.updatedAt.toISOString(),
  };
}

export const internalRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post<{ Body: CreateBookmarkBody }>(
    '/internal/bookmarks',
    {
      schema: {
        operationId: 'createBookmarkInternal',
        summary: 'Create bookmark (internal)',
        description: 'Internal endpoint for creating bookmarks from other services.',
        tags: ['internal'],
        body: createBookmarkBodySchema,
        response: {
          201: {
            description: 'Created bookmark',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  url: { type: 'string' },
                  bookmark: bookmarkResponseSchema,
                },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: CreateBookmarkBody }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /internal/bookmarks',
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Internal auth failed for create bookmark');
        reply.status(401);
        return { error: 'Unauthorized' };
      }

      const { bookmarkRepository } = getServices();
      const result = await createBookmark(
        { bookmarkRepository, logger: request.log },
        {
          userId: request.body.userId,
          url: request.body.url,
          title: request.body.title,
          description: request.body.description,
          tags: request.body.tags,
          status: request.body.status,
          source: request.body.source,
          sourceId: request.body.sourceId,
        }
      );

      if (!result.ok) {
        if (result.error.code === 'DUPLICATE_URL') {
          return await reply.fail('CONFLICT', result.error.message, undefined, {
            existingBookmarkId: result.error.existingBookmarkId,
          });
        }
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      const bookmarkId = result.value.id;
      const bookmarkUrl = `/#/bookmarks/${bookmarkId}`;

      const { enrichPublisher } = getServices();
      const publishResult = await enrichPublisher.publishEnrichBookmark({
        type: 'bookmarks.enrich',
        bookmarkId,
        userId: request.body.userId,
        url: request.body.url,
      });

      if (!publishResult.ok) {
        request.log.warn(
          { bookmarkId, error: publishResult.error },
          'Failed to publish enrichment event'
        );
      }

      void reply.status(201);
      return await reply.ok({
        id: bookmarkId,
        url: bookmarkUrl,
        bookmark: formatBookmark(result.value),
      });
    }
  );

  fastify.get<{ Params: BookmarkParams; Querystring: GetBookmarkQuery }>(
    '/internal/bookmarks/:id',
    {
      schema: {
        operationId: 'getBookmarkInternal',
        summary: 'Get bookmark (internal)',
        description: 'Internal endpoint for getting a bookmark by ID.',
        tags: ['internal'],
        params: bookmarkParamsSchema,
        querystring: getBookmarkQuerySchema,
        response: {
          200: {
            description: 'Bookmark',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: bookmarkResponseSchema,
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: BookmarkParams; Querystring: GetBookmarkQuery }>,
      reply: FastifyReply
    ) => {
      logIncomingRequest(request, {
        message: 'Received request to GET /internal/bookmarks/:id',
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Internal auth failed for get bookmark');
        reply.status(401);
        return { error: 'Unauthorized' };
      }

      const { bookmarkRepository } = getServices();
      const result = await getBookmark(
        { bookmarkRepository, logger: request.log },
        request.params.id,
        request.query.userId
      );

      if (!result.ok) {
        if (result.error.code === 'NOT_FOUND') {
          return await reply.fail('NOT_FOUND', 'Bookmark not found');
        }
        if (result.error.code === 'FORBIDDEN') {
          return await reply.fail('FORBIDDEN', 'Access denied');
        }
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok(formatBookmark(result.value));
    }
  );

  fastify.patch<{ Params: BookmarkParams; Body: UpdateBookmarkBody }>(
    '/internal/bookmarks/:id',
    {
      schema: {
        operationId: 'updateBookmarkInternal',
        summary: 'Update bookmark (internal)',
        description: 'Internal endpoint for updating bookmarks with AI summary and OG data.',
        tags: ['internal'],
        params: bookmarkParamsSchema,
        body: updateBookmarkBodySchema,
        response: {
          200: {
            description: 'Updated bookmark',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: bookmarkResponseSchema,
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: BookmarkParams; Body: UpdateBookmarkBody }>,
      reply: FastifyReply
    ) => {
      logIncomingRequest(request, {
        message: 'Received request to PATCH /internal/bookmarks/:id',
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Internal auth failed for update bookmark');
        reply.status(401);
        return { error: 'Unauthorized' };
      }

      const { bookmarkRepository } = getServices();
      const result = await updateBookmarkInternal(
        { bookmarkRepository, logger: request.log },
        request.params.id,
        {
          title: request.body.title,
          description: request.body.description,
          tags: request.body.tags,
          archived: request.body.archived,
          aiSummary: request.body.aiSummary,
          ogPreview: request.body.ogPreview,
          ogFetchStatus: request.body.ogFetchStatus,
        }
      );

      if (!result.ok) {
        if (result.error.code === 'NOT_FOUND') {
          return await reply.fail('NOT_FOUND', 'Bookmark not found');
        }
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok(formatBookmark(result.value));
    }
  );

  done();
};
