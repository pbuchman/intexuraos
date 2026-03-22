import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { imposeOnBuffer } from '../domain/usecases/imposeOnBuffer.js';
import { listBuffers } from '../domain/usecases/listBuffers.js';
import { getBufferWorkspace } from '../domain/usecases/getBufferWorkspace.js';

interface ImposeBody {
  bufferId?: string;
  utterance: string;
}

interface BufferParams {
  id: string;
}

const imposeBodySchema = {
  type: 'object',
  required: ['utterance'],
  properties: {
    bufferId: { type: 'string', maxLength: 128 },
    utterance: { type: 'string', minLength: 1, maxLength: 10000 },
  },
} as const;

const bufferParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', maxLength: 128 },
  },
} as const;

export const hellscriptRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post<{ Body: ImposeBody }>(
    '/hellscript/impose',
    {
      schema: {
        operationId: 'imposeOnBuffer',
        summary: 'Impose on buffer',
        description:
          'Send an utterance to a hellscript buffer. Creates buffer if bufferId is omitted.',
        tags: ['hellscript'],
        security: [{ bearerAuth: [] }],
        body: imposeBodySchema,
        response: {
          200: {
            description: 'Impose result',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  bufferId: { type: 'string' },
                  action: { type: 'string' },
                  latestDraftVersionId: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: ImposeBody }>, reply: FastifyReply) => {
      logIncomingRequest(request);
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const services = getServices();
      const result = await imposeOnBuffer(
        {
          repository: services.hellscriptRepository,
          writingConfigRepository: services.writingConfigRepository,
          interpreter: services.intentInterpreter,
          draftGenerator: services.draftGenerator,
          logger: request.log,
        },
        {
          userId: user.userId,
          bufferId: request.body.bufferId,
          utterance: request.body.utterance,
        }
      );

      if (!result.ok) {
        if (result.error.message === 'Buffer not found') {
          return await reply.fail('NOT_FOUND', result.error.message);
        }
        request.log.error({ err: result.error }, 'Impose failed');
        return await reply.fail('INTERNAL_ERROR', 'An internal error occurred');
      }

      return await reply.ok(result.value);
    }
  );

  fastify.get(
    '/hellscript/buffers',
    {
      schema: {
        operationId: 'listBuffers',
        summary: 'List buffers',
        description: 'List all hellscript buffers for the authenticated user.',
        tags: ['hellscript'],
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            description: 'List of buffers',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    userId: { type: 'string' },
                    title: { type: 'string' },
                    eventCount: { type: 'number' },
                    latestDraftVersionNumber: { type: 'number', nullable: true },
                    latestDraftVersionId: { type: 'string', nullable: true },
                    createdAt: { type: 'string' },
                    updatedAt: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request);
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const services = getServices();
      const result = await listBuffers(
        { repository: services.hellscriptRepository, logger: request.log },
        user.userId
      );

      if (!result.ok) {
        request.log.error({ err: result.error }, 'List buffers failed');
        return await reply.fail('INTERNAL_ERROR', 'An internal error occurred');
      }

      return await reply.ok(result.value);
    }
  );

  fastify.get<{ Params: BufferParams }>(
    '/hellscript/buffers/:id',
    {
      schema: {
        operationId: 'getBufferWorkspace',
        summary: 'Get buffer workspace',
        description:
          'Get a buffer with its events, draft versions, and materialized state.',
        tags: ['hellscript'],
        security: [{ bearerAuth: [] }],
        params: bufferParamsSchema,
        response: {
          200: {
            description: 'Buffer workspace',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  buffer: { type: 'object', additionalProperties: true },
                  events: {
                    type: 'array',
                    items: { type: 'object', additionalProperties: true },
                  },
                  draftVersions: {
                    type: 'array',
                    items: { type: 'object', additionalProperties: true },
                  },
                  state: { type: 'object', nullable: true, additionalProperties: true },
                },
              },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: BufferParams }>,
      reply: FastifyReply
    ) => {
      logIncomingRequest(request, { includeParams: true });
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const services = getServices();
      const result = await getBufferWorkspace(
        { repository: services.hellscriptRepository, logger: request.log },
        request.params.id,
        user.userId
      );

      if (!result.ok) {
        if (result.error.message === 'Buffer not found') {
          return await reply.fail('NOT_FOUND', result.error.message);
        }
        request.log.error({ err: result.error }, 'Get workspace failed');
        return await reply.fail('INTERNAL_ERROR', 'An internal error occurred');
      }

      return await reply.ok(result.value);
    }
  );

  done();
};
