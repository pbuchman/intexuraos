/**
 * Public routes for composite feed endpoints.
 * CRUD operations for user-created composite feeds.
 */

import { randomUUID } from 'node:crypto';
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { requireAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import type {
  CompositeFeed,
  CreateCompositeFeedRequest,
  NotificationFilterConfig,
} from '../domain/compositeFeed/index.js';
import {
  createCompositeFeed,
  getCompositeFeedData,
  getCompositeFeedJsonSchema,
} from '../domain/compositeFeed/index.js';
import { getDataInsightSnapshot, refreshSnapshot } from '../domain/snapshot/index.js';
import {
  createCompositeFeedBodySchema,
  updateCompositeFeedBodySchema,
  compositeFeedParamsSchema,
  compositeFeedResponseSchema,
  compositeFeedDataResponseSchema,
  snapshotResponseSchema,
} from './compositeFeedSchemas.js';

interface NotificationFilterInput {
  id?: string;
  name: string;
  app?: string[];
  source?: string;
  title?: string;
}

interface CreateCompositeFeedBody {
  purpose: string;
  staticSourceIds: string[];
  notificationFilters: NotificationFilterInput[];
}

interface UpdateCompositeFeedBody {
  purpose?: string;
  staticSourceIds?: string[];
  notificationFilters?: NotificationFilterInput[];
}

function ensureFilterIds(filters: NotificationFilterInput[]): NotificationFilterConfig[] {
  return filters.map((filter) => ({
    ...filter,
    id: filter.id ?? randomUUID(),
  }));
}

interface CompositeFeedParams {
  id: string;
}

function formatCompositeFeed(feed: CompositeFeed): object {
  return {
    id: feed.id,
    userId: feed.userId,
    name: feed.name,
    purpose: feed.purpose,
    staticSourceIds: feed.staticSourceIds,
    notificationFilters: feed.notificationFilters,
    createdAt: feed.createdAt.toISOString(),
    updatedAt: feed.updatedAt.toISOString(),
  };
}

export const compositeFeedRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post<{ Body: CreateCompositeFeedBody }>(
    '/composite-feeds',
    {
      schema: {
        operationId: 'createCompositeFeed',
        summary: 'Create composite feed',
        description:
          'Create a new composite feed aggregating data sources and notification filters.',
        tags: ['composite-feeds'],
        security: [{ bearerAuth: [] }],
        body: createCompositeFeedBodySchema,
        response: {
          201: {
            description: 'Created composite feed',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: compositeFeedResponseSchema,
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: CreateCompositeFeedBody }>, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const services = getServices();
      const createRequest: CreateCompositeFeedRequest = {
        purpose: request.body.purpose,
        staticSourceIds: request.body.staticSourceIds,
        notificationFilters: ensureFilterIds(request.body.notificationFilters),
      };

      const result = await createCompositeFeed(user.userId, createRequest, {
        compositeFeedRepository: services.compositeFeedRepository,
        dataSourceRepository: services.dataSourceRepository,
        feedNameGenerationService: services.feedNameGenerationService,
      });

      if (!result.ok) {
        const error = result.error;
        if (error.code === 'VALIDATION_ERROR') {
          void reply.status(400);
          return await reply.fail('INVALID_REQUEST', error.message);
        }
        if (error.code === 'SOURCE_NOT_FOUND') {
          void reply.status(404);
          return await reply.fail('NOT_FOUND', error.message);
        }
        if (error.code === 'NAME_GENERATION_ERROR') {
          return await reply.fail('DOWNSTREAM_ERROR', error.message);
        }
        return await reply.fail('INTERNAL_ERROR', error.message);
      }

      refreshSnapshot(result.value.id, user.userId, {
        snapshotRepository: services.snapshotRepository,
        compositeFeedRepository: services.compositeFeedRepository,
        dataSourceRepository: services.dataSourceRepository,
        mobileNotificationsClient: services.mobileNotificationsClient,
      }).catch((error: unknown) => {
        request.log.warn({ error, feedId: result.value.id }, 'Failed to refresh snapshot after feed creation');
      });

      void reply.status(201);
      return {
        success: true,
        data: formatCompositeFeed(result.value),
        diagnostics: {
          requestId: request.requestId,
          durationMs: Date.now() - request.startTime,
        },
      };
    }
  );

  fastify.get(
    '/composite-feeds',
    {
      schema: {
        operationId: 'listCompositeFeeds',
        summary: 'List composite feeds',
        description: 'List all composite feeds for the authenticated user.',
        tags: ['composite-feeds'],
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            description: 'List of composite feeds',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'array',
                items: compositeFeedResponseSchema,
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { compositeFeedRepository } = getServices();
      const result = await compositeFeedRepository.listByUserId(user.userId);

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error);
      }

      return await reply.ok(result.value.map(formatCompositeFeed));
    }
  );

  fastify.get<{ Params: CompositeFeedParams }>(
    '/composite-feeds/:id',
    {
      schema: {
        operationId: 'getCompositeFeed',
        summary: 'Get composite feed',
        description: 'Get a specific composite feed by ID.',
        tags: ['composite-feeds'],
        security: [{ bearerAuth: [] }],
        params: compositeFeedParamsSchema,
        response: {
          200: {
            description: 'Composite feed',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: compositeFeedResponseSchema,
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: CompositeFeedParams }>, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { compositeFeedRepository } = getServices();
      const result = await compositeFeedRepository.getById(request.params.id, user.userId);

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error);
      }

      if (result.value === null) {
        return await reply.fail('NOT_FOUND', 'Composite feed not found');
      }

      return await reply.ok(formatCompositeFeed(result.value));
    }
  );

  fastify.put<{ Params: CompositeFeedParams; Body: UpdateCompositeFeedBody }>(
    '/composite-feeds/:id',
    {
      schema: {
        operationId: 'updateCompositeFeed',
        summary: 'Update composite feed',
        description: 'Update an existing composite feed.',
        tags: ['composite-feeds'],
        security: [{ bearerAuth: [] }],
        params: compositeFeedParamsSchema,
        body: updateCompositeFeedBodySchema,
        response: {
          200: {
            description: 'Updated composite feed',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: compositeFeedResponseSchema,
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: CompositeFeedParams; Body: UpdateCompositeFeedBody }>,
      reply: FastifyReply
    ) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { compositeFeedRepository, snapshotRepository, dataSourceRepository, mobileNotificationsClient } = getServices();
      const updateData: {
        purpose?: string;
        staticSourceIds?: string[];
        notificationFilters?: NotificationFilterConfig[];
      } = {};
      if (request.body.purpose !== undefined) {
        updateData.purpose = request.body.purpose;
      }
      if (request.body.staticSourceIds !== undefined) {
        updateData.staticSourceIds = request.body.staticSourceIds;
      }
      if (request.body.notificationFilters !== undefined) {
        updateData.notificationFilters = ensureFilterIds(request.body.notificationFilters);
      }
      const result = await compositeFeedRepository.update(
        request.params.id,
        user.userId,
        updateData
      );

      if (!result.ok) {
        if (result.error === 'Composite feed not found') {
          return await reply.fail('NOT_FOUND', result.error);
        }
        return await reply.fail('INTERNAL_ERROR', result.error);
      }

      refreshSnapshot(request.params.id, user.userId, {
        snapshotRepository,
        compositeFeedRepository,
        dataSourceRepository,
        mobileNotificationsClient,
      }).catch((error: unknown) => {
        request.log.warn({ error, feedId: request.params.id }, 'Failed to refresh snapshot after feed update');
      });

      return await reply.ok(formatCompositeFeed(result.value));
    }
  );

  fastify.delete<{ Params: CompositeFeedParams }>(
    '/composite-feeds/:id',
    {
      schema: {
        operationId: 'deleteCompositeFeed',
        summary: 'Delete composite feed',
        description: 'Delete a composite feed.',
        tags: ['composite-feeds'],
        security: [{ bearerAuth: [] }],
        params: compositeFeedParamsSchema,
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
    async (request: FastifyRequest<{ Params: CompositeFeedParams }>, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const services = getServices();
      const result = await services.compositeFeedRepository.delete(
        request.params.id,
        user.userId
      );

      if (!result.ok) {
        if (result.error === 'Composite feed not found') {
          return await reply.fail('NOT_FOUND', result.error);
        }
        return await reply.fail('INTERNAL_ERROR', result.error);
      }

      const snapshotDeleteResult = await services.snapshotRepository.delete(
        request.params.id,
        user.userId
      );

      if (!snapshotDeleteResult.ok) {
        request.log.warn(
          {
            feedId: request.params.id,
            userId: user.userId,
            error: snapshotDeleteResult.error,
          },
          'Failed to delete snapshot after feed deletion (non-fatal)'
        );
      }

      return await reply.ok({});
    }
  );

  fastify.get<{ Params: CompositeFeedParams }>(
    '/composite-feeds/:id/schema',
    {
      schema: {
        operationId: 'getCompositeFeedSchema',
        summary: 'Get composite feed schema',
        description: 'Get the JSON Schema for composite feed data (for LLM consumption).',
        tags: ['composite-feeds'],
        security: [{ bearerAuth: [] }],
        params: compositeFeedParamsSchema,
        response: {
          200: {
            description: 'JSON Schema for composite feed data',
            type: 'object',
            additionalProperties: true,
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: CompositeFeedParams }>, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { compositeFeedRepository } = getServices();
      const result = await compositeFeedRepository.getById(request.params.id, user.userId);

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error);
      }

      if (result.value === null) {
        return await reply.fail('NOT_FOUND', 'Composite feed not found');
      }

      return await reply.ok(getCompositeFeedJsonSchema());
    }
  );

  fastify.get<{ Params: CompositeFeedParams }>(
    '/composite-feeds/:id/data',
    {
      schema: {
        operationId: 'getCompositeFeedData',
        summary: 'Get composite feed data',
        description: 'Get aggregated data for a composite feed.',
        tags: ['composite-feeds'],
        security: [{ bearerAuth: [] }],
        params: compositeFeedParamsSchema,
        response: {
          200: {
            description: 'Aggregated composite feed data',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: compositeFeedDataResponseSchema,
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: CompositeFeedParams }>, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const services = getServices();
      const result = await getCompositeFeedData(request.params.id, user.userId, {
        compositeFeedRepository: services.compositeFeedRepository,
        dataSourceRepository: services.dataSourceRepository,
        mobileNotificationsClient: services.mobileNotificationsClient,
      });

      if (!result.ok) {
        const error = result.error;
        if (error.code === 'NOT_FOUND') {
          return await reply.fail('NOT_FOUND', error.message);
        }
        return await reply.fail('INTERNAL_ERROR', error.message);
      }

      return await reply.ok(result.value);
    }
  );

  fastify.get<{ Params: CompositeFeedParams }>(
    '/composite-feeds/:id/snapshot',
    {
      schema: {
        operationId: 'getCompositeFeedSnapshot',
        summary: 'Get composite feed snapshot',
        description:
          'Get pre-computed snapshot data for a composite feed. Returns cached data computed by scheduler.',
        tags: ['composite-feeds'],
        security: [{ bearerAuth: [] }],
        params: compositeFeedParamsSchema,
        response: {
          200: {
            description: 'Pre-computed snapshot data',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: snapshotResponseSchema,
            },
          },
          404: {
            description: 'Snapshot not found',
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
    async (request: FastifyRequest<{ Params: CompositeFeedParams }>, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const services = getServices();
      const result = await getDataInsightSnapshot(request.params.id, user.userId, {
        snapshotRepository: services.snapshotRepository,
      });

      if (!result.ok) {
        const error = result.error;
        if (error.code === 'NOT_FOUND') {
          return await reply.fail('NOT_FOUND', 'Snapshot not yet generated for this feed');
        }
        return await reply.fail('INTERNAL_ERROR', error.message);
      }

      const snapshot = result.value;
      return await reply.ok({
        feedId: snapshot.feedId,
        feedName: snapshot.feedName,
        purpose: snapshot.data.purpose,
        generatedAt: snapshot.generatedAt.toISOString(),
        expiresAt: snapshot.expiresAt.toISOString(),
        staticSources: snapshot.data.staticSources,
        notifications: snapshot.data.notifications,
      });
    }
  );

  done();
};
