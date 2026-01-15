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

function slugify(title: string, maxLength = 50): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, maxLength)
    .replace(/-$/, '');
}

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
      request.log.info(
        { model, userId, textLength: text.length },
        'Processing prompt generation request'
      );

      const modelConfig = IMAGE_PROMPT_MODELS[model as ImagePromptModel];
      const { userServiceClient, createPromptGenerator } = getServices();

      request.log.info(
        { userId, provider: modelConfig.provider },
        'Fetching API keys from user-service'
      );
      const keysResult = await userServiceClient.getApiKeys(userId);
      if (!keysResult.ok) {
        request.log.error(
          { userId, error: keysResult.error },
          'Failed to retrieve API keys from user-service'
        );
        reply.status(502);
        return await reply.fail('DOWNSTREAM_ERROR', 'Failed to retrieve API keys');
      }

      const apiKey = keysResult.value[modelConfig.provider];
      if (apiKey === undefined) {
        request.log.warn(
          { userId, provider: modelConfig.provider },
          'User missing required API key'
        );
        reply.status(400);
        return await reply.fail(
          'INVALID_REQUEST',
          `No ${modelConfig.provider} API key configured for this user`
        );
      }

      request.log.info({ model, provider: modelConfig.provider }, 'Starting prompt generation');
      const generator = createPromptGenerator(modelConfig.provider, apiKey, userId);
      const result = await generator.generateThumbnailPrompt(text);

      if (!result.ok) {
        request.log.error(
          { model, errorCode: result.error.code, errorMessage: result.error.message },
          'Prompt generation failed'
        );
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

      request.log.info(
        { model, promptLength: result.value.prompt.length },
        'Prompt generation completed successfully'
      );
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

      const { prompt, model, userId, title } = request.body;
      const slug = title !== undefined ? slugify(title) : undefined;
      request.log.info(
        { model, userId, promptLength: prompt.length, slug },
        'Processing image generation request'
      );

      const { userServiceClient, createImageGenerator, generatedImageRepository, imageStorage } =
        getServices();

      request.log.info({ userId }, 'Fetching API keys from user-service');
      const keysResult = await userServiceClient.getApiKeys(userId);
      if (!keysResult.ok) {
        request.log.error(
          { userId, error: keysResult.error },
          'Failed to get API keys from user-service'
        );
        reply.status(502);
        return await reply.fail(
          'DOWNSTREAM_ERROR',
          `Failed to get API keys: ${keysResult.error.message}`
        );
      }

      const modelConfig = IMAGE_GENERATION_MODELS[model as ImageGenerationModel];
      const apiKey = keysResult.value[modelConfig.provider];

      if (apiKey === undefined) {
        request.log.warn(
          { userId, provider: modelConfig.provider },
          'User missing required API key for image generation'
        );
        reply.status(400);
        return await reply.fail('INVALID_REQUEST', `No ${modelConfig.provider} API key configured`);
      }

      request.log.info({ model, provider: modelConfig.provider }, 'Starting image generation');
      const imageGenerator = createImageGenerator(model as ImageGenerationModel, apiKey, userId);
      const result = await imageGenerator.generate(prompt, { slug });

      if (!result.ok) {
        request.log.error(
          { model, errorCode: result.error.code, errorMessage: result.error.message },
          'Image generation failed'
        );
        reply.status(502);
        return await reply.fail('DOWNSTREAM_ERROR', result.error.message);
      }

      request.log.info({ model, imageId: result.value.id }, 'Image generated, saving to database');
      const generatedImage = {
        ...result.value,
        userId,
        ...(slug !== undefined && { slug }),
      };
      const saveResult = await generatedImageRepository.save(generatedImage);
      if (!saveResult.ok) {
        request.log.error(
          { error: saveResult.error, imageId: result.value.id },
          'Failed to save generated image to DB'
        );

        const deleteResult = await imageStorage.delete(result.value.id);
        if (!deleteResult.ok) {
          request.log.error(
            { error: deleteResult.error, imageId: result.value.id },
            'Failed to cleanup orphaned image'
          );
        }

        reply.status(500);
        return await reply.fail('INTERNAL_ERROR', 'Failed to save image record');
      }

      request.log.info(
        { model, imageId: result.value.id },
        'Image generation completed successfully'
      );
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
          'Internal endpoint for deleting images. Used by research-agent when research is unshared.',
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

      const imageResult = await generatedImageRepository.findById(id);
      const slug = imageResult.ok ? imageResult.value.slug : undefined;

      const storageResult = await imageStorage.delete(id, slug);
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

      request.log.info({ imageId: id, slug }, 'Image deleted via internal endpoint');

      return await reply.ok({ deleted: true });
    }
  );

  done();
};
