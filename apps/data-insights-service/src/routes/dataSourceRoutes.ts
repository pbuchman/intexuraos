/**
 * Public routes for data source endpoints.
 * CRUD operations for user-uploaded custom data sources.
 */

import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { requireAuth } from '@intexuraos/common-http';
import { getServices, getServiceConfig } from '../services.js';
import { createUserServiceClient } from '../infra/user/userServiceClient.js';
import { createTitleGenerationService } from '../infra/gemini/titleGenerationService.js';
import type { DataSource } from '../domain/dataSource/index.js';
import {
  createDataSourceBodySchema,
  updateDataSourceBodySchema,
  generateTitleBodySchema,
  dataSourceParamsSchema,
  dataSourceResponseSchema,
  generateTitleResponseSchema,
} from './dataSourceSchemas.js';

interface CreateDataSourceBody {
  title: string;
  content: string;
}

interface UpdateDataSourceBody {
  title?: string;
  content?: string;
}

interface GenerateTitleBody {
  content: string;
}

interface DataSourceParams {
  id: string;
}

function formatDataSource(ds: DataSource): object {
  return {
    id: ds.id,
    userId: ds.userId,
    title: ds.title,
    content: ds.content,
    createdAt: ds.createdAt.toISOString(),
    updatedAt: ds.updatedAt.toISOString(),
  };
}

export const dataSourceRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post<{ Body: CreateDataSourceBody }>(
    '/data-sources',
    {
      schema: {
        operationId: 'createDataSource',
        summary: 'Create data source',
        description: 'Create a new custom data source.',
        tags: ['data-sources'],
        security: [{ bearerAuth: [] }],
        body: createDataSourceBodySchema,
        response: {
          201: {
            description: 'Created data source',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: dataSourceResponseSchema,
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: CreateDataSourceBody }>, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { dataSourceRepository } = getServices();
      const result = await dataSourceRepository.create(user.userId, request.body);

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error);
      }

      void reply.status(201);
      return {
        success: true,
        data: formatDataSource(result.value),
        diagnostics: {
          requestId: request.requestId,
          durationMs: Date.now() - request.startTime,
        },
      };
    }
  );

  fastify.get(
    '/data-sources',
    {
      schema: {
        operationId: 'listDataSources',
        summary: 'List data sources',
        description: 'List all data sources for the authenticated user.',
        tags: ['data-sources'],
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            description: 'List of data sources',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'array',
                items: dataSourceResponseSchema,
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

      const { dataSourceRepository } = getServices();
      const result = await dataSourceRepository.listByUserId(user.userId);

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error);
      }

      return await reply.ok(result.value.map(formatDataSource));
    }
  );

  fastify.get<{ Params: DataSourceParams }>(
    '/data-sources/:id',
    {
      schema: {
        operationId: 'getDataSource',
        summary: 'Get data source',
        description: 'Get a specific data source by ID.',
        tags: ['data-sources'],
        security: [{ bearerAuth: [] }],
        params: dataSourceParamsSchema,
        response: {
          200: {
            description: 'Data source',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: dataSourceResponseSchema,
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: DataSourceParams }>, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { dataSourceRepository } = getServices();
      const result = await dataSourceRepository.getById(request.params.id, user.userId);

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error);
      }

      if (result.value === null) {
        return await reply.fail('NOT_FOUND', 'Data source not found');
      }

      return await reply.ok(formatDataSource(result.value));
    }
  );

  fastify.put<{ Params: DataSourceParams; Body: UpdateDataSourceBody }>(
    '/data-sources/:id',
    {
      schema: {
        operationId: 'updateDataSource',
        summary: 'Update data source',
        description: 'Update an existing data source.',
        tags: ['data-sources'],
        security: [{ bearerAuth: [] }],
        params: dataSourceParamsSchema,
        body: updateDataSourceBodySchema,
        response: {
          200: {
            description: 'Updated data source',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: dataSourceResponseSchema,
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: DataSourceParams; Body: UpdateDataSourceBody }>,
      reply: FastifyReply
    ) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { dataSourceRepository } = getServices();
      const result = await dataSourceRepository.update(
        request.params.id,
        user.userId,
        request.body
      );

      if (!result.ok) {
        if (result.error === 'Data source not found') {
          return await reply.fail('NOT_FOUND', result.error);
        }
        return await reply.fail('INTERNAL_ERROR', result.error);
      }

      return await reply.ok(formatDataSource(result.value));
    }
  );

  fastify.delete<{ Params: DataSourceParams }>(
    '/data-sources/:id',
    {
      schema: {
        operationId: 'deleteDataSource',
        summary: 'Delete data source',
        description: 'Delete a data source.',
        tags: ['data-sources'],
        security: [{ bearerAuth: [] }],
        params: dataSourceParamsSchema,
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
    async (request: FastifyRequest<{ Params: DataSourceParams }>, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { dataSourceRepository } = getServices();
      const result = await dataSourceRepository.delete(request.params.id, user.userId);

      if (!result.ok) {
        if (result.error === 'Data source not found') {
          return await reply.fail('NOT_FOUND', result.error);
        }
        return await reply.fail('INTERNAL_ERROR', result.error);
      }

      return await reply.ok({});
    }
  );

  fastify.post<{ Body: GenerateTitleBody }>(
    '/data-sources/generate-title',
    {
      schema: {
        operationId: 'generateDataSourceTitle',
        summary: 'Generate title',
        description: 'Generate a title for content using AI.',
        tags: ['data-sources'],
        security: [{ bearerAuth: [] }],
        body: generateTitleBodySchema,
        response: {
          200: {
            description: 'Generated title',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: generateTitleResponseSchema,
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: GenerateTitleBody }>, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const config = getServiceConfig();
      const userServiceClient = createUserServiceClient({
        baseUrl: config.userServiceUrl,
        internalAuthToken: config.internalAuthToken,
      });
      const titleService = createTitleGenerationService(userServiceClient);

      const result = await titleService.generateTitle(user.userId, request.body.content);

      if (!result.ok) {
        const error = result.error;
        if (error.code === 'NO_API_KEY') {
          return await reply.fail('MISCONFIGURED', error.message);
        }
        return await reply.fail('DOWNSTREAM_ERROR', error.message);
      }

      return await reply.ok({ title: result.value });
    }
  );

  done();
};
