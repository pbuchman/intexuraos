import type { FastifyPluginCallback } from 'fastify';
import { requireAuth } from '@intexuraos/common-http';
import { IMAGE_GENERATION_MODELS, type ImageGenerationModel } from '../domain/index.js';
import { getServices } from '../services.js';
import {
  generateImageBodySchema,
  generateImageResponseSchema,
  deleteImageParamsSchema,
  deleteImageResponseSchema,
  type GenerateImageBody,
  type DeleteImageParams,
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

      const { imageStorage } = getServices();

      const generatedImage = { ...result.value, userId: user.userId };
      const saveResult = await generatedImageRepository.save(generatedImage);
      if (!saveResult.ok) {
        request.log.error({ error: saveResult.error }, 'Failed to save generated image to DB');

        const deleteResult = await imageStorage.delete(result.value.id);
        if (!deleteResult.ok) {
          request.log.error({ error: deleteResult.error }, 'Failed to cleanup orphaned image');
        }

        reply.status(500);
        return await reply.fail('INTERNAL_ERROR', 'Failed to save image record');
      }

      return await reply.ok({
        id: result.value.id,
        thumbnailUrl: result.value.thumbnailUrl,
        fullSizeUrl: result.value.fullSizeUrl,
      });
    }
  );

  app.delete<{ Params: DeleteImageParams }>(
    '/images/:id',
    {
      schema: {
        operationId: 'deleteImage',
        summary: 'Delete a generated image',
        description:
          'Deletes a generated image from storage and database. Only the creator can delete.',
        tags: ['images'],
        security: [{ bearerAuth: [] }],
        params: deleteImageParamsSchema,
        response: {
          200: deleteImageResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const user = await requireAuth(request, reply);
      if (user === null) return;

      const { imageStorage, generatedImageRepository } = getServices();

      const imageResult = await generatedImageRepository.findById(request.params.id);
      if (!imageResult.ok) {
        reply.status(404);
        return await reply.fail('NOT_FOUND', 'Image not found');
      }

      if (imageResult.value.userId !== user.userId) {
        reply.status(403);
        return await reply.fail('FORBIDDEN', 'Not authorized to delete this image');
      }

      const storageResult = await imageStorage.delete(request.params.id);
      if (!storageResult.ok) {
        request.log.error({ error: storageResult.error }, 'Failed to delete image from storage');
      }

      const repoResult = await generatedImageRepository.delete(request.params.id);
      if (!repoResult.ok) {
        request.log.error({ error: repoResult.error }, 'Failed to delete image from database');
      }

      return await reply.ok({ deleted: true });
    }
  );

  done();
};
