import type { FastifyPluginCallback } from 'fastify';
import { requireAuth } from '@intexuraos/common-http';
import { IMAGE_GENERATION_MODELS, type ImageGenerationModel } from '../domain/index.js';
import { getServices } from '../services.js';
import {
  generateImageBodySchema,
  generateImageResponseSchema,
  type GenerateImageBody,
} from './schemas/index.js';

export const imageRoutes: FastifyPluginCallback = (app, _opts, done) => {
  app.post<{ Body: GenerateImageBody }>(
    '/images/generate',
    {
      schema: {
        operationId: 'generateImage',
        summary: 'Generate image from prompt',
        description: 'Generates an image using OpenAI GPT-image-1 or Google Nano Banana Pro',
        tags: ['images'],
        security: [{ bearerAuth: [] }],
        body: generateImageBodySchema,
        response: {
          200: generateImageResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const user = await requireAuth(request, reply);
      if (user === null) return;

      const { prompt, model } = request.body;

      const { userServiceClient, createImageGenerator, generatedImageRepository } = getServices();

      const keysResult = await userServiceClient.getApiKeys(user.userId);
      if (!keysResult.ok) {
        reply.status(502);
        return await reply.fail(
          'DOWNSTREAM_ERROR',
          `Failed to get API keys: ${keysResult.error.message}`
        );
      }

      const modelConfig = IMAGE_GENERATION_MODELS[model as ImageGenerationModel];
      const apiKey = keysResult.value[modelConfig.provider];

      if (apiKey === undefined) {
        reply.status(400);
        return await reply.fail('INVALID_REQUEST', `No ${modelConfig.provider} API key configured`);
      }

      const imageGenerator = createImageGenerator(model as ImageGenerationModel, apiKey);
      const result = await imageGenerator.generate(prompt);

      if (!result.ok) {
        reply.status(502);
        return await reply.fail('DOWNSTREAM_ERROR', result.error.message);
      }

      const saveResult = await generatedImageRepository.save(result.value);
      if (!saveResult.ok) {
        // Best-effort tracking - image was generated successfully and URLs are valid
        request.log.error({ error: saveResult.error }, 'Failed to save generated image');
      }

      return await reply.ok({
        id: result.value.id,
        thumbnailUrl: result.value.thumbnailUrl,
        fullSizeUrl: result.value.fullSizeUrl,
      });
    }
  );

  done();
};
