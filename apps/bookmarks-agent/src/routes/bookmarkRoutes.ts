import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { createBookmark } from '../domain/usecases/createBookmark.js';
import { getBookmark } from '../domain/usecases/getBookmark.js';
import { listBookmarks } from '../domain/usecases/listBookmarks.js';
import { updateBookmark } from '../domain/usecases/updateBookmark.js';
import { deleteBookmark } from '../domain/usecases/deleteBookmark.js';
import { archiveBookmark } from '../domain/usecases/archiveBookmark.js';
import { unarchiveBookmark } from '../domain/usecases/unarchiveBookmark.js';
import type { Bookmark, OgFetchStatus } from '../domain/models/bookmark.js';

interface CreateBookmarkBody {
  url: string;
  title?: string;
  description?: string;
  tags?: string[];
  source: string;
  sourceId: string;
}

interface UpdateBookmarkBody {
  title?: string;
  description?: string;
  tags?: string[];
  archived?: boolean;
}

interface BookmarkParams {
  id: string;
}

interface ListBookmarksQuery {
  archived?: string;
  tags?: string;
  ogFetchStatus?: OgFetchStatus;
}

const ogFetchStatusEnum = ['pending', 'processed', 'failed'];

const createBookmarkBodySchema = {
  type: 'object',
  required: ['url', 'source', 'sourceId'],
  properties: {
    url: { type: 'string', format: 'uri' },
    title: { type: 'string' },
    description: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
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
  },
} as const;

const bookmarkParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string' },
  },
} as const;

const listBookmarksQuerySchema = {
  type: 'object',
  properties: {
    archived: { type: 'string', enum: ['true', 'false'] },
    tags: { type: 'string' },
    ogFetchStatus: { type: 'string', enum: ogFetchStatusEnum },
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

export const bookmarkRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.get<{ Querystring: ListBookmarksQuery }>(
    '/bookmarks',
    {
      schema: {
        operationId: 'listBookmarks',
        summary: 'List bookmarks',
        description: 'List all bookmarks for the authenticated user.',
        tags: ['bookmarks'],
        security: [{ bearerAuth: [] }],
        querystring: listBookmarksQuerySchema,
        response: {
          200: {
            description: 'List of bookmarks',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'array', items: bookmarkResponseSchema },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: ListBookmarksQuery }>, reply: FastifyReply) => {
      logIncomingRequest(request);
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { bookmarkRepository } = getServices();
      const filters = {
        archived:
          request.query.archived === 'true'
            ? true
            : request.query.archived === 'false'
              ? false
              : undefined,
        tags: request.query.tags !== undefined ? request.query.tags.split(',') : undefined,
        ogFetchStatus: request.query.ogFetchStatus,
      };

      const result = await listBookmarks(
        { bookmarkRepository, logger: request.log },
        user.userId,
        filters
      );

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok(result.value.map(formatBookmark));
    }
  );

  fastify.post<{ Body: CreateBookmarkBody }>(
    '/bookmarks',
    {
      schema: {
        operationId: 'createBookmark',
        summary: 'Create bookmark',
        description: 'Create a new bookmark.',
        tags: ['bookmarks'],
        security: [{ bearerAuth: [] }],
        body: createBookmarkBodySchema,
        response: {
          201: {
            description: 'Created bookmark',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: bookmarkResponseSchema,
            },
          },
          409: {
            description: 'Bookmark with this URL already exists',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  message: { type: 'string' },
                  details: {
                    type: 'object',
                    properties: {
                      existingBookmarkId: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: CreateBookmarkBody }>, reply: FastifyReply) => {
      logIncomingRequest(request);
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { bookmarkRepository } = getServices();
      const result = await createBookmark(
        { bookmarkRepository, logger: request.log },
        {
          userId: user.userId,
          url: request.body.url,
          title: request.body.title,
          description: request.body.description,
          tags: request.body.tags,
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

      void reply.status(201);
      return await reply.ok(formatBookmark(result.value));
    }
  );

  fastify.get<{ Params: BookmarkParams }>(
    '/bookmarks/:id',
    {
      schema: {
        operationId: 'getBookmark',
        summary: 'Get bookmark',
        description: 'Get a specific bookmark by ID.',
        tags: ['bookmarks'],
        security: [{ bearerAuth: [] }],
        params: bookmarkParamsSchema,
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
    async (request: FastifyRequest<{ Params: BookmarkParams }>, reply: FastifyReply) => {
      logIncomingRequest(request, { includeParams: true });
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { bookmarkRepository } = getServices();
      const result = await getBookmark(
        { bookmarkRepository, logger: request.log },
        request.params.id,
        user.userId
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
    '/bookmarks/:id',
    {
      schema: {
        operationId: 'updateBookmark',
        summary: 'Update bookmark',
        description: 'Update an existing bookmark.',
        tags: ['bookmarks'],
        security: [{ bearerAuth: [] }],
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
      logIncomingRequest(request, { includeParams: true });
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { bookmarkRepository } = getServices();
      const result = await updateBookmark(
        { bookmarkRepository, logger: request.log },
        request.params.id,
        user.userId,
        {
          title: request.body.title,
          description: request.body.description,
          tags: request.body.tags,
          archived: request.body.archived,
        }
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

  fastify.delete<{ Params: BookmarkParams }>(
    '/bookmarks/:id',
    {
      schema: {
        operationId: 'deleteBookmark',
        summary: 'Delete bookmark',
        description: 'Delete a bookmark.',
        tags: ['bookmarks'],
        security: [{ bearerAuth: [] }],
        params: bookmarkParamsSchema,
        response: {
          200: {
            description: 'Deletion confirmed',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'object' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: BookmarkParams }>, reply: FastifyReply) => {
      logIncomingRequest(request, { includeParams: true });
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { bookmarkRepository } = getServices();
      const result = await deleteBookmark(
        { bookmarkRepository, logger: request.log },
        request.params.id,
        user.userId
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

      return await reply.ok({});
    }
  );

  fastify.post<{ Params: BookmarkParams }>(
    '/bookmarks/:id/archive',
    {
      schema: {
        operationId: 'archiveBookmark',
        summary: 'Archive bookmark',
        description: 'Archive a bookmark.',
        tags: ['bookmarks'],
        security: [{ bearerAuth: [] }],
        params: bookmarkParamsSchema,
        response: {
          200: {
            description: 'Archived bookmark',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: bookmarkResponseSchema,
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: BookmarkParams }>, reply: FastifyReply) => {
      logIncomingRequest(request, { includeParams: true });
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { bookmarkRepository } = getServices();
      const result = await archiveBookmark(
        { bookmarkRepository, logger: request.log },
        request.params.id,
        user.userId
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

  fastify.post<{ Params: BookmarkParams }>(
    '/bookmarks/:id/unarchive',
    {
      schema: {
        operationId: 'unarchiveBookmark',
        summary: 'Unarchive bookmark',
        description: 'Unarchive a bookmark.',
        tags: ['bookmarks'],
        security: [{ bearerAuth: [] }],
        params: bookmarkParamsSchema,
        response: {
          200: {
            description: 'Unarchived bookmark',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: bookmarkResponseSchema,
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: BookmarkParams }>, reply: FastifyReply) => {
      logIncomingRequest(request, { includeParams: true });
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { bookmarkRepository } = getServices();
      const result = await unarchiveBookmark(
        { bookmarkRepository, logger: request.log },
        request.params.id,
        user.userId
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

  fastify.get<{ Querystring: { url: string } }>(
    '/images/proxy',
    {
      schema: {
        operationId: 'proxyImage',
        summary: 'Proxy external image',
        description:
          'Proxy an external image to bypass CORS restrictions. No authentication required as original images are already public.',
        tags: ['images'],
        querystring: {
          type: 'object',
          required: ['url'],
          properties: {
            url: { type: 'string', description: 'URL-encoded image URL to proxy' },
          },
        },
        response: {
          200: {
            description: 'Proxied image',
            type: 'string',
            contentMediaType: 'image/*',
          },
          400: {
            description: 'Invalid URL',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  message: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Querystring: { url: string } }>,
      reply: FastifyReply
    ): Promise<void> => {
      const { url: encodedUrl } = request.query;

      let imageUrl: string;
      try {
        imageUrl = decodeURIComponent(encodedUrl);
        const parsed = new URL(imageUrl);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          void reply.status(400);
          await reply.send({
            success: false,
            error: { code: 'INVALID_URL', message: 'Only HTTP/HTTPS URLs are allowed' },
          });
          return;
        }
      } catch {
        void reply.status(400);
        await reply.send({
          success: false,
          error: { code: 'INVALID_URL', message: 'Invalid URL format' },
        });
        return;
      }

      request.log.info({ imageUrl }, 'Proxying image');

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => {
          controller.abort();
        }, 10000);

        const response = await fetch(imageUrl, {
          signal: controller.signal,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (compatible; IntexuraOS/1.0; +https://intexuraos.cloud)',
            Accept: 'image/*',
          },
        });

        clearTimeout(timeout);

        if (!response.ok) {
          request.log.warn({ imageUrl, status: response.status }, 'Failed to fetch image');
          void reply.status(response.status);
          await reply.send({
            success: false,
            error: { code: 'FETCH_FAILED', message: `Failed to fetch image: ${String(response.status)}` },
          });
          return;
        }

        const contentType = response.headers.get('content-type') ?? 'image/jpeg';
        if (!contentType.startsWith('image/')) {
          void reply.status(400);
          await reply.send({
            success: false,
            error: { code: 'NOT_AN_IMAGE', message: 'URL does not point to an image' },
          });
          return;
        }

        const buffer = Buffer.from(await response.arrayBuffer());

        void reply.header('Content-Type', contentType);
        void reply.header('Cache-Control', 'public, max-age=86400');
        void reply.header('Access-Control-Allow-Origin', '*');
        await reply.send(buffer);
      } catch (error) {
        const isAborted = error instanceof Error && error.name === 'AbortError';
        request.log.error({ imageUrl, error: String(error), isAborted }, 'Error proxying image');
        void reply.status(isAborted ? 504 : 500);
        await reply.send({
          success: false,
          error: {
            code: isAborted ? 'TIMEOUT' : 'PROXY_ERROR',
            message: isAborted ? 'Image fetch timed out' : 'Failed to proxy image',
          },
        });
      }
    }
  );

  done();
};
