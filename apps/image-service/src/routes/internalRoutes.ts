import type { FastifyPluginCallback } from 'fastify';
import { validateInternalAuth, logIncomingRequest, apiFail } from '@intexuraos/common-http';
import { IMAGE_PROMPT_MODELS, IMAGE_GENERATION_MODELS } from '../domain/index.js';
import type { ImagePromptModel, ImageGenerationModel } from '../domain/index.js';
import { getServices } from '../services.js';
import {
  generatePromptBodySchema,
  generatePromptResponseSchema,
  generateImageBodySchema,
  generateImageResponseSchema,
  deleteImageParamsSchema,
  deleteImageResponseSchema,
  type GeneratePromptBody,
  type GenerateImageBody,
  type DeleteImageParams,
} from './schemas/index.js';

export const internalRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post<{ Body: GeneratePromptBody }>(
    '/internal/images/prompts/generate',
    {
      schema: {
        operationId: 'generatePromptInternal',
        summary: 'Generate image prompt from text (internal)',
        description:
          'Internal endpoint for generating thumbnail/cover image prompts from text content',
        tags: ['internal'],
        body: generatePromptBodySchema,
        response: {
          200: generatePromptResponseSchema,
        },
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /internal/images/prompts/generate',
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Internal auth failed for generate prompt');
        reply.status(401);
        return { error: 'Unauthorized' };
      }

      const { text, model, userId } = request.body;

      const modelConfig = IMAGE_PROMPT_MODELS[model as ImagePromptModel];
      const { userServiceClient, createPromptGenerator } = getServices();

      const keysResult = await userServiceClient.getApiKeys(userId);
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

      const generator = createPromptGenerator(modelConfig.provider, apiKey, request.log);
      const result = await generator.generateThumbnailPrompt(text);

      if (!result.ok) {
        if (result.error.code === 'RATE_LIMITED') {
          const errorResponse = apiFail('DOWNSTREAM_ERROR', result.error.message, {
            requestId: request.requestId,
            durationMs: Date.now() - request.startTime,
          });
          return await reply.status(429).send(errorResponse);
        }
        reply.status(502);
        return await reply.fail('DOWNSTREAM_ERROR', result.error.message);
      }

      return await reply.ok(result.value);
    }
  );

  fastify.post<{ Body: GenerateImageBody }>(
    '/internal/images/generate',
    {
      schema: {
        operationId: 'generateImageInternal',
        summary: 'Generate image from prompt (internal)',
        description: 'Internal endpoint for generating images using OpenAI or Google models',
        tags: ['internal'],
        body: generateImageBodySchema,
        response: {
          200: generateImageResponseSchema,
        },
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /internal/images/generate',
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Internal auth failed for generate image');
        reply.status(401);
        return { error: 'Unauthorized' };
      }

      const { prompt, model, userId } = request.body;

      const { userServiceClient, createImageGenerator, generatedImageRepository, imageStorage } =
        getServices();

      const keysResult = await userServiceClient.getApiKeys(userId);
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

      const generatedImage = { ...result.value, userId };
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

  fastify.delete<{ Params: DeleteImageParams }>(
    '/internal/images/:id',
    {
      schema: {
        operationId: 'deleteImageInternal',
        summary: 'Delete image (internal)',
        description:
          'Internal endpoint for deleting images. Used by llm-orchestrator when research is unshared.',
        tags: ['internal'],
        params: deleteImageParamsSchema,
        response: {
          200: deleteImageResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;

      logIncomingRequest(request, {
        message: `Received request to DELETE /internal/images/${id}`,
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Internal auth failed for delete image');
        reply.status(401);
        return { error: 'Unauthorized' };
      }

      const { imageStorage, generatedImageRepository } = getServices();

      const storageResult = await imageStorage.delete(id);
      if (!storageResult.ok) {
        request.log.error(
          { error: storageResult.error, imageId: id },
          'Failed to delete image from storage'
        );
      }

      const repoResult = await generatedImageRepository.delete(id);
      if (!repoResult.ok) {
        request.log.error(
          { error: repoResult.error, imageId: id },
          'Failed to delete image from database'
        );
      }

      request.log.info({ imageId: id }, 'Image deleted via internal endpoint');

      return await reply.ok({ deleted: true });
    }
  );

  done();
};
