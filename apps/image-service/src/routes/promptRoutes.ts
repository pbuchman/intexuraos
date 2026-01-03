import type { FastifyPluginCallback } from 'fastify';
import { requireAuth, apiFail as createErrorResponse } from '@intexuraos/common-http';
import { IMAGE_PROMPT_MODELS, type ImagePromptModel } from '../domain/index.js';
import { getServices } from '../services.js';
import {
  generatePromptBodySchema,
  generatePromptResponseSchema,
  type GeneratePromptBody,
} from './schemas/index.js';

export const promptRoutes: FastifyPluginCallback = (app, _opts, done) => {
  app.post<{ Body: GeneratePromptBody }>(
    '/prompts/generate',
    {
      schema: {
        operationId: 'generatePrompt',
        summary: 'Generate image prompt from text',
        description:
          'Generates a thumbnail/cover image prompt from text content using the specified LLM model',
        tags: ['prompts'],
        security: [{ bearerAuth: [] }],
        body: generatePromptBodySchema,
        response: {
          200: generatePromptResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const user = await requireAuth(request, reply);
      if (user === null) return;

      const { text, model } = request.body;

      const modelConfig = IMAGE_PROMPT_MODELS[model as ImagePromptModel];
      const { userServiceClient, createPromptGenerator } = getServices();

      const keysResult = await userServiceClient.getApiKeys(user.userId);
      if (!keysResult.ok) {
        reply.status(502);
        return await reply.fail('DOWNSTREAM_ERROR', 'Failed to retrieve API keys');
      }

      const apiKey = keysResult.value[modelConfig.provider];
      if (apiKey === undefined) {
        reply.status(400);
        return await reply.fail(
          'INVALID_REQUEST',
          `No ${modelConfig.provider} API key configured for this user`
        );
      }

      const generator = createPromptGenerator(modelConfig.provider, apiKey);
      const result = await generator.generateThumbnailPrompt(text);

      if (!result.ok) {
        if (result.error.code === 'RATE_LIMITED') {
          const errorResponse = createErrorResponse('DOWNSTREAM_ERROR', result.error.message, {
            requestId: request.requestId,
            durationMs: Date.now() - request.startTime,
          });
          return await reply.status(429).send(errorResponse);
        }
        return await reply.fail('DOWNSTREAM_ERROR', result.error.message);
      }

      return await reply.ok(result.value);
    }
  );

  done();
};
