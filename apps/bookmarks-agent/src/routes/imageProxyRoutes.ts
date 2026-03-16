import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../services.js';

export const imageProxyRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.get<{ Querystring: { url: string } }>(
    '/images/proxy',
    {
      schema: {
        operationId: 'proxyImage',
        summary: 'Proxy external image',
        description:
          'Proxy an external image to bypass CORS restrictions. No authentication required as original images are already public.',
        tags: ['images'],
        querystring: {
          type: 'object',
          required: ['url'],
          properties: {
            url: { type: 'string', description: 'URL-encoded image URL to proxy' },
          },
        },
        response: {
          200: {
            description: 'Proxied image',
            type: 'string',
            contentMediaType: 'image/*',
          },
          400: {
            description: 'Invalid URL',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  message: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Querystring: { url: string } }>,
      reply: FastifyReply
    ): Promise<void> => {
      logIncomingRequest(request);
      const { url: encodedUrl } = request.query;
      const { imageProxy } = getServices();

      const result = await imageProxy.proxyImage(encodedUrl);

      if (!result.ok) {
        void reply.status(result.error.httpStatus);
        // @allow-raw-send: Image proxy - binary response endpoint with legacy error format
        await reply.send({
          success: false,
          error: { code: result.error.code, message: result.error.message },
        });
        return;
      }

      void reply.header('Content-Type', result.value.contentType);
      void reply.header('Cache-Control', 'public, max-age=86400');
      void reply.header('Access-Control-Allow-Origin', '*');
      // @allow-raw-send: Image proxy - binary response (Buffer)
      await reply.send(result.value.buffer);
    }
  );

  done();
};
