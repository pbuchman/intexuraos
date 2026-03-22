import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { isValidCategory } from '../domain/models/writingCategory.js';
import type { WritingCategory } from '../domain/models/writingCategory.js';
import { getWritingConfig } from '../domain/usecases/getWritingConfig.js';
import { updateStyleInstructions } from '../domain/usecases/updateStyleInstructions.js';
import { clearStyleInstructions } from '../domain/usecases/clearStyleInstructions.js';
import { listWritingSamples } from '../domain/usecases/listWritingSamples.js';
import { createWritingSample, MaxSamplesError } from '../domain/usecases/createWritingSample.js';
import { updateWritingSample, SampleNotFoundError } from '../domain/usecases/updateWritingSample.js';
import { deleteWritingSample } from '../domain/usecases/deleteWritingSample.js';

interface CategoryParams {
  category: string;
}

interface SampleParams {
  category: string;
  sampleId: string;
}

interface StyleBody {
  text: string;
}

interface SampleBody {
  title: string;
  text: string;
}

const categoryParamsSchema = {
  type: 'object',
  required: ['category'],
  properties: {
    category: { type: 'string' },
  },
} as const;

const sampleParamsSchema = {
  type: 'object',
  required: ['category', 'sampleId'],
  properties: {
    category: { type: 'string' },
    sampleId: { type: 'string', maxLength: 128 },
  },
} as const;

const styleBodySchema = {
  type: 'object',
  required: ['text'],
  properties: {
    text: { type: 'string', minLength: 1, maxLength: 5000 },
  },
} as const;

const sampleBodySchema = {
  type: 'object',
  required: ['title', 'text'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 200 },
    text: { type: 'string', minLength: 1, maxLength: 10000 },
  },
} as const;

function validateCategory(
  category: string,
  reply: FastifyReply
): WritingCategory | null {
  if (!isValidCategory(category)) {
    void reply.fail('INVALID_REQUEST', 'Invalid category. Must be threads, linkedin, or general.');
    return null;
  }
  return category;
}

export const writingConfigRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // GET /hellscript/writing-config
  fastify.get(
    '/hellscript/writing-config',
    {
      schema: {
        operationId: 'getWritingConfig',
        summary: 'Get writing config',
        description: 'Get style instructions for all categories.',
        tags: ['hellscript'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request);
      const user = await requireAuth(request, reply);
      if (user === null) return;

      const services = getServices();
      const result = await getWritingConfig(
        { writingConfigRepository: services.writingConfigRepository },
        user.userId
      );

      if (!result.ok) {
        request.log.error({ err: result.error }, 'Get writing config failed');
        return await reply.fail('INTERNAL_ERROR', 'An internal error occurred');
      }

      return await reply.ok(result.value);
    }
  );

  // PUT /hellscript/writing-config/:category/style
  fastify.put<{ Params: CategoryParams; Body: StyleBody }>(
    '/hellscript/writing-config/:category/style',
    {
      schema: {
        operationId: 'updateStyleInstructions',
        summary: 'Update style instructions',
        description: 'Set style instructions for a category.',
        tags: ['hellscript'],
        security: [{ bearerAuth: [] }],
        params: categoryParamsSchema,
        body: styleBodySchema,
      },
    },
    async (
      request: FastifyRequest<{ Params: CategoryParams; Body: StyleBody }>,
      reply: FastifyReply
    ) => {
      logIncomingRequest(request, { includeParams: true });
      const user = await requireAuth(request, reply);
      if (user === null) return;

      const category = validateCategory(request.params.category, reply);
      if (category === null) return;

      const services = getServices();
      const result = await updateStyleInstructions(
        { writingConfigRepository: services.writingConfigRepository },
        user.userId,
        category,
        request.body.text
      );

      if (!result.ok) {
        request.log.error({ err: result.error }, 'Update style instructions failed');
        return await reply.fail('INTERNAL_ERROR', 'An internal error occurred');
      }

      return await reply.ok({ updated: true });
    }
  );

  // DELETE /hellscript/writing-config/:category/style
  fastify.delete<{ Params: CategoryParams }>(
    '/hellscript/writing-config/:category/style',
    {
      schema: {
        operationId: 'deleteStyleInstructions',
        summary: 'Clear style instructions',
        description: 'Remove style instructions for a category.',
        tags: ['hellscript'],
        security: [{ bearerAuth: [] }],
        params: categoryParamsSchema,
      },
    },
    async (
      request: FastifyRequest<{ Params: CategoryParams }>,
      reply: FastifyReply
    ) => {
      logIncomingRequest(request, { includeParams: true });
      const user = await requireAuth(request, reply);
      if (user === null) return;

      const category = validateCategory(request.params.category, reply);
      if (category === null) return;

      const services = getServices();
      const result = await clearStyleInstructions(
        { writingConfigRepository: services.writingConfigRepository },
        user.userId,
        category
      );

      if (!result.ok) {
        request.log.error({ err: result.error }, 'Clear style instructions failed');
        return await reply.fail('INTERNAL_ERROR', 'An internal error occurred');
      }

      return await reply.ok({ cleared: true });
    }
  );

  // GET /hellscript/writing-config/:category/samples
  fastify.get<{ Params: CategoryParams }>(
    '/hellscript/writing-config/:category/samples',
    {
      schema: {
        operationId: 'listWritingSamples',
        summary: 'List writing samples',
        description: 'List writing samples for a category.',
        tags: ['hellscript'],
        security: [{ bearerAuth: [] }],
        params: categoryParamsSchema,
      },
    },
    async (
      request: FastifyRequest<{ Params: CategoryParams }>,
      reply: FastifyReply
    ) => {
      logIncomingRequest(request, { includeParams: true });
      const user = await requireAuth(request, reply);
      if (user === null) return;

      const category = validateCategory(request.params.category, reply);
      if (category === null) return;

      const services = getServices();
      const result = await listWritingSamples(
        { writingConfigRepository: services.writingConfigRepository },
        user.userId,
        category
      );

      if (!result.ok) {
        request.log.error({ err: result.error }, 'List writing samples failed');
        return await reply.fail('INTERNAL_ERROR', 'An internal error occurred');
      }

      return await reply.ok(result.value);
    }
  );

  // POST /hellscript/writing-config/:category/samples
  fastify.post<{ Params: CategoryParams; Body: SampleBody }>(
    '/hellscript/writing-config/:category/samples',
    {
      schema: {
        operationId: 'createWritingSample',
        summary: 'Create writing sample',
        description: 'Create a writing sample in a category (max 5 per category).',
        tags: ['hellscript'],
        security: [{ bearerAuth: [] }],
        params: categoryParamsSchema,
        body: sampleBodySchema,
      },
    },
    async (
      request: FastifyRequest<{ Params: CategoryParams; Body: SampleBody }>,
      reply: FastifyReply
    ) => {
      logIncomingRequest(request, { includeParams: true });
      const user = await requireAuth(request, reply);
      if (user === null) return;

      const category = validateCategory(request.params.category, reply);
      if (category === null) return;

      const services = getServices();
      const result = await createWritingSample(
        { writingConfigRepository: services.writingConfigRepository },
        user.userId,
        category,
        request.body.title,
        request.body.text
      );

      if (!result.ok) {
        if (result.error instanceof MaxSamplesError) {
          return await reply.fail('CONFLICT', result.error.message);
        }
        request.log.error({ err: result.error }, 'Create writing sample failed');
        return await reply.fail('INTERNAL_ERROR', 'An internal error occurred');
      }

      return await reply.status(201).ok(result.value);
    }
  );

  // PUT /hellscript/writing-config/:category/samples/:sampleId
  fastify.put<{ Params: SampleParams; Body: SampleBody }>(
    '/hellscript/writing-config/:category/samples/:sampleId',
    {
      schema: {
        operationId: 'updateWritingSample',
        summary: 'Update writing sample',
        description: 'Update a writing sample.',
        tags: ['hellscript'],
        security: [{ bearerAuth: [] }],
        params: sampleParamsSchema,
        body: sampleBodySchema,
      },
    },
    async (
      request: FastifyRequest<{ Params: SampleParams; Body: SampleBody }>,
      reply: FastifyReply
    ) => {
      logIncomingRequest(request, { includeParams: true });
      const user = await requireAuth(request, reply);
      if (user === null) return;

      const category = validateCategory(request.params.category, reply);
      if (category === null) return;

      const services = getServices();
      const result = await updateWritingSample(
        { writingConfigRepository: services.writingConfigRepository },
        user.userId,
        request.params.sampleId,
        category,
        request.body.title,
        request.body.text
      );

      if (!result.ok) {
        if (result.error instanceof SampleNotFoundError) {
          return await reply.fail('NOT_FOUND', result.error.message);
        }
        request.log.error({ err: result.error }, 'Update writing sample failed');
        return await reply.fail('INTERNAL_ERROR', 'An internal error occurred');
      }

      return await reply.ok({ updated: true });
    }
  );

  // DELETE /hellscript/writing-config/:category/samples/:sampleId
  fastify.delete<{ Params: SampleParams }>(
    '/hellscript/writing-config/:category/samples/:sampleId',
    {
      schema: {
        operationId: 'deleteWritingSample',
        summary: 'Delete writing sample',
        description: 'Delete a writing sample.',
        tags: ['hellscript'],
        security: [{ bearerAuth: [] }],
        params: sampleParamsSchema,
      },
    },
    async (
      request: FastifyRequest<{ Params: SampleParams }>,
      reply: FastifyReply
    ) => {
      logIncomingRequest(request, { includeParams: true });
      const user = await requireAuth(request, reply);
      if (user === null) return;

      const category = validateCategory(request.params.category, reply);
      if (category === null) return;

      const services = getServices();
      const result = await deleteWritingSample(
        { writingConfigRepository: services.writingConfigRepository },
        user.userId,
        request.params.sampleId,
        category
      );

      if (!result.ok) {
        if (result.error instanceof SampleNotFoundError) {
          return await reply.fail('NOT_FOUND', result.error.message);
        }
        request.log.error({ err: result.error }, 'Delete writing sample failed');
        return await reply.fail('INTERNAL_ERROR', 'An internal error occurred');
      }

      return await reply.ok({ deleted: true });
    }
  );

  done();
};
