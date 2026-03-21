import type { FastifyPluginCallback } from 'fastify';
import { validateInternalAuth, logIncomingRequest } from '@intexuraos/common-http';
import { IMAGE_PROMPT_MODELS, IMAGE_GENERATION_MODELS } from '../domain/index.js';
import type { ImagePromptModel, ImageGenerationModel } from '../domain/index.js';
import { getServices } from '../services.js';
import {
  createGeneratePromptUseCase,
  createGenerateImageUseCase,
  createDeleteImageUseCase,
} from '../application/index.js';
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
        return await reply.fail('UNAUTHORIZED', 'Internal auth failed for generate prompt');
      }

      const { text, model, userId } = request.body;
      request.log.info(
        { model, userId, textLength: text.length },
        'Processing prompt generation request'
      );

      const modelConfig = IMAGE_PROMPT_MODELS[model as ImagePromptModel];
      const { userServiceClient, createPromptGenerator } = getServices();

      const useCase = createGeneratePromptUseCase(
        { userServiceClient, createPromptGenerator, logger: request.log },
        modelConfig
      );
      const result = await useCase({ text, model, userId });

      if (!result.ok) {
        if (result.error.code === 'API_KEYS_UNAVAILABLE') {
          reply.status(502);
          return await reply.fail('DOWNSTREAM_ERROR', result.error.message);
        }
        if (result.error.code === 'MISSING_API_KEY') {
          reply.status(400);
          return await reply.fail('INVALID_REQUEST', result.error.message);
        }
        if (result.error.code === 'RATE_LIMITED') {
          return await reply.fail('RATE_LIMITED', result.error.message);
        }
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
        return await reply.fail('UNAUTHORIZED', 'Internal auth failed for generate image');
      }

      const { prompt, model, userId, title } = request.body;
      request.log.info(
        { model, userId, promptLength: prompt.length },
        'Processing image generation request'
      );

      const { userServiceClient, createImageGenerator, generatedImageRepository, imageStorage } =
        getServices();
      const modelConfig = IMAGE_GENERATION_MODELS[model as ImageGenerationModel];

      const useCase = createGenerateImageUseCase(
        {
          userServiceClient,
          createImageGenerator,
          generatedImageRepository,
          imageStorage,
          logger: request.log,
        },
        modelConfig
      );
      const result = await useCase({ prompt, model: model as ImageGenerationModel, userId, title });

      if (!result.ok) {
        if (result.error.code === 'API_KEYS_UNAVAILABLE') {
          reply.status(502);
          return await reply.fail('DOWNSTREAM_ERROR', result.error.message);
        }
        if (result.error.code === 'MISSING_API_KEY') {
          reply.status(400);
          return await reply.fail('INVALID_REQUEST', result.error.message);
        }
        if (result.error.code === 'SAVE_FAILED') {
          reply.status(500);
          return await reply.fail('INTERNAL_ERROR', result.error.message);
        }
        reply.status(502);
        return await reply.fail('DOWNSTREAM_ERROR', result.error.message);
      }

      return await reply.ok(result.value);
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
        return await reply.fail('UNAUTHORIZED', 'Internal auth failed for delete image');
      }

      const { generatedImageRepository, imageStorage } = getServices();

      const useCase = createDeleteImageUseCase({
        generatedImageRepository,
        imageStorage,
        logger: request.log,
      });
      const result = await useCase({ id });

      /* v8 ignore start -- test-infra: DeleteImageUseCase error type is never, fakes cannot simulate error @preserve */
      return await reply.ok({ deleted: result.ok ? result.value.deleted : true });
      /* v8 ignore stop @preserve */
    }
  );

  done();
};
