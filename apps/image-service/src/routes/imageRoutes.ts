import type { FastifyPluginCallback } from 'fastify';
import { requireAuth } from '@intexuraos/common-http';
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
        description: 'Generates an image from the provided prompt (fake implementation)',
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

      const { imageGenerator, generatedImageRepository } = getServices();

      const result = await imageGenerator.generate(prompt, model);

      if (!result.ok) {
        reply.status(502);
        return await reply.fail('DOWNSTREAM_ERROR', result.error.message);
      }

      const saveResult = await generatedImageRepository.save(result.value);
      if (!saveResult.ok) {
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
