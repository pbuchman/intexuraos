/**
 * Research Routes
 *
 * POST   /research     - Create new research
 * GET    /research     - List user's researches
 * GET    /research/:id - Get single research
 * DELETE /research/:id - Delete research
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { requireAuth } from '@intexuraos/common-http';
import {
  submitResearch,
  getResearch,
  listResearches,
  deleteResearch,
  type LlmProvider,
} from '../domain/research/index.js';
import { getServices } from '../services.js';
import {
  createResearchBodySchema,
  createResearchResponseSchema,
  listResearchesQuerySchema,
  listResearchesResponseSchema,
  getResearchResponseSchema,
  deleteResearchResponseSchema,
  researchIdParamsSchema,
} from './schemas/index.js';

interface CreateResearchBody {
  prompt: string;
  selectedLlms: LlmProvider[];
  synthesisLlm?: LlmProvider;
}

interface ListResearchesQuery {
  limit?: number;
  cursor?: string;
}

interface ResearchIdParams {
  id: string;
}

export const researchRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // POST /research
  fastify.post(
    '/research',
    {
      schema: {
        operationId: 'createResearch',
        summary: 'Create new research',
        description: 'Submit a research prompt to be processed by multiple LLMs.',
        tags: ['research'],
        body: createResearchBodySchema,
        response: {
          201: createResearchResponseSchema,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const body = request.body as CreateResearchBody;
      const { researchRepo, generateId, processResearchAsync } = getServices();

      const result = await submitResearch(
        {
          userId: user.userId,
          prompt: body.prompt,
          selectedLlms: body.selectedLlms,
          synthesisLlm: body.synthesisLlm ?? 'anthropic',
        },
        { researchRepo, generateId }
      );

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      // Trigger async processing (fire and forget)
      processResearchAsync(result.value.id);

      return await reply.code(201).ok(result.value);
    }
  );

  // GET /research
  fastify.get(
    '/research',
    {
      schema: {
        operationId: 'listResearches',
        summary: 'List researches',
        description: "Get a paginated list of the user's researches.",
        tags: ['research'],
        querystring: listResearchesQuerySchema,
        response: {
          200: listResearchesResponseSchema,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const query = request.query as ListResearchesQuery;
      const { researchRepo } = getServices();

      const params: { userId: string; limit?: number; cursor?: string } = {
        userId: user.userId,
      };
      if (query.limit !== undefined) {
        params.limit = query.limit;
      }
      if (query.cursor !== undefined) {
        params.cursor = query.cursor;
      }

      const result = await listResearches(params, { researchRepo });

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok(result.value);
    }
  );

  // GET /research/:id
  fastify.get(
    '/research/:id',
    {
      schema: {
        operationId: 'getResearch',
        summary: 'Get research',
        description: 'Get details of a specific research.',
        tags: ['research'],
        params: researchIdParamsSchema,
        response: {
          200: getResearchResponseSchema,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const params = request.params as ResearchIdParams;
      const { researchRepo } = getServices();

      const result = await getResearch(params.id, { researchRepo });

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      if (result.value === null) {
        return await reply.fail('NOT_FOUND', 'Research not found');
      }

      // Check ownership
      if (result.value.userId !== user.userId) {
        return await reply.fail('FORBIDDEN', 'Access denied');
      }

      return await reply.ok(result.value);
    }
  );

  // DELETE /research/:id
  fastify.delete(
    '/research/:id',
    {
      schema: {
        operationId: 'deleteResearch',
        summary: 'Delete research',
        description: 'Delete a specific research.',
        tags: ['research'],
        params: researchIdParamsSchema,
        response: {
          200: deleteResearchResponseSchema,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const params = request.params as ResearchIdParams;
      const { researchRepo } = getServices();

      // Check ownership first
      const existing = await getResearch(params.id, { researchRepo });
      if (!existing.ok || existing.value === null) {
        return await reply.fail('NOT_FOUND', 'Research not found');
      }

      if (existing.value.userId !== user.userId) {
        return await reply.fail('FORBIDDEN', 'Access denied');
      }

      const result = await deleteResearch(params.id, { researchRepo });

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok(null);
    }
  );

  done();
};
