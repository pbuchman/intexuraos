import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { validateInternalAuth, logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../services.js';

export const internalRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.delete(
    '/internal/images/:id',
    {
      schema: {
        operationId: 'deleteImageInternal',
        summary: 'Delete image (internal)',
        description:
          'Internal endpoint for deleting images. Used by llm-orchestrator when research is unshared.',
        tags: ['internal'],
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Image ID to delete' },
          },
          required: ['id'],
        },
        response: {
          200: {
            description: 'Image deleted successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  deleted: { type: 'boolean' },
                },
              },
            },
            required: ['success', 'data'],
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
      const { id } = request.params as { id: string };

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

      return {
        success: true,
        data: { deleted: true },
      };
    }
  );

  done();
};
