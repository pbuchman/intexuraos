/**
 * Internal Routes for service-to-service communication.
 * POST /internal/research/draft - Create a draft research
 */

import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { validateInternalAuth } from '@intexuraos/common-http';
import { createDraftResearch, type LlmProvider } from '../domain/research/index.js';
import { getServices } from '../services.js';
import { llmProviderSchema, researchSchema } from './schemas/index.js';

interface CreateDraftResearchBody {
  userId: string;
  title: string;
  prompt: string;
  selectedLlms: LlmProvider[];
  sourceActionId?: string;
}

export const internalRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post(
    '/internal/research/draft',
    {
      schema: {
        operationId: 'createInternalResearchDraft',
        summary: 'Create draft research (internal)',
        description:
          'Internal endpoint for service-to-service communication. Creates a draft research that requires user approval.',
        tags: ['internal'],
        body: {
          type: 'object',
          required: ['userId', 'title', 'prompt', 'selectedLlms'],
          properties: {
            userId: { type: 'string', description: 'User ID' },
            title: { type: 'string', minLength: 1, maxLength: 200 },
            prompt: { type: 'string', minLength: 10, maxLength: 20000 },
            selectedLlms: {
              type: 'array',
              items: llmProviderSchema,
              minItems: 1,
              maxItems: 3,
            },
            sourceActionId: { type: 'string', description: 'ID of the originating action' },
          },
        },
        response: {
          200: {
            description: 'Draft research created',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: researchSchema,
            },
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        reply.status(401);
        return { error: 'Unauthorized' };
      }

      const body = request.body as CreateDraftResearchBody;
      const { researchRepo, generateId } = getServices();

      const createParams: Parameters<typeof createDraftResearch>[0] = {
        id: generateId(),
        userId: body.userId,
        title: body.title,
        prompt: body.prompt,
        selectedLlms: body.selectedLlms,
        synthesisLlm: 'anthropic',
      };
      if (body.sourceActionId !== undefined) {
        createParams.sourceActionId = body.sourceActionId;
      }
      const research = createDraftResearch(createParams);

      const saveResult = await researchRepo.save(research);

      if (!saveResult.ok) {
        return await reply.fail('INTERNAL_ERROR', saveResult.error.message);
      }

      return await reply.ok(saveResult.value);
    }
  );

  done();
};
